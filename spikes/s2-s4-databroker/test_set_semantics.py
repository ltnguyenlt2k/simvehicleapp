"""Spike S-3/S-4: what does sdv.databroker.v1 Broker.SetDatapoints (used by Velocitas SDK set()) change?"""
import os, sys, time
import grpc
from sdv.databroker.v1 import broker_pb2, broker_pb2_grpc, types_pb2
from kuksa_client.grpc import VSSClient, Datapoint

HOST, PORT = os.environ.get("VDB_HOST", "databroker"), int(os.environ.get("VDB_PORT", "55555"))
MIRRORED = os.environ.get("EXPECT_MIRROR", "0") == "1"
stub = broker_pb2_grpc.BrokerStub(grpc.insecure_channel(f"{HOST}:{PORT}"))

def sdv_set(path, dp):
    reply = stub.SetDatapoints(broker_pb2.SetDatapointsRequest(datapoints={path: dp}))
    return {k: types_pb2.DatapointError.Name(v) for k, v in reply.errors.items()}

def v1_get(client, path):
    cur = client.get_current_values([path]).get(path)
    tgt = client.get_target_values([path]).get(path)
    return (cur.value if cur else None), (tgt.value if tgt else None)

results = []
def check(name, ok, detail):
    results.append(ok); print(("PASS " if ok else "FAIL ") + name + " :: " + str(detail))

with VSSClient(HOST, PORT) as c:
    # 1. sensor via Broker.SetDatapoints -> must be rejected
    err = sdv_set("Vehicle.Speed", types_pb2.Datapoint(float_value=130.0))
    check("sdv v1 set on sensor is rejected", err.get("Vehicle.Speed") == "ACCESS_DENIED", err)

    # 2. inject sensor current value via kuksa.val.v1 (what signal-gateway does)
    c.set_current_values({"Vehicle.Speed": Datapoint(130.0)})
    cur, _ = v1_get(c, "Vehicle.Speed")
    check("kuksa.val.v1 set_current_values on sensor works", cur == 130.0, cur)

    # 3. sdv v1 Get (SDK get()) sees injected sensor value
    r = stub.GetDatapoints(broker_pb2.GetDatapointsRequest(datapoints=["Vehicle.Speed"]))
    check("sdv v1 GetDatapoints returns injected current value", r.datapoints["Vehicle.Speed"].float_value == 130.0, r.datapoints["Vehicle.Speed"])

    # 4. actuator via Broker.SetDatapoints (= SDK set())
    err = sdv_set("Vehicle.Body.Lights.Hazard.IsSignaling", types_pb2.Datapoint(bool_value=True))
    time.sleep(1.0)
    cur, tgt = v1_get(c, "Vehicle.Body.Lights.Hazard.IsSignaling")
    check("sdv v1 set on actuator accepted", err == {}, err)
    check("sdv v1 set writes ACTUATOR TARGET", tgt is True, f"target={tgt}")
    if MIRRORED:
        check("mock-provider mirrors target -> current", cur is True, f"current={cur}")
    else:
        check("without provider current value is unchanged", cur is None or cur is False, f"current={cur}")

    # 5. enum actuator string
    err = sdv_set("Vehicle.Body.Windshield.Front.Wiping.Mode", types_pb2.Datapoint(string_value="FAST"))
    time.sleep(1.0)
    cur, tgt = v1_get(c, "Vehicle.Body.Windshield.Front.Wiping.Mode")
    check("enum actuator target set", err == {} and tgt == "FAST", f"err={err} target={tgt} current={cur}")
    err = sdv_set("Vehicle.Body.Windshield.Front.Wiping.Mode", types_pb2.Datapoint(string_value="TURBO"))
    check("value outside 'allowed' is rejected by databroker", err != {}, err)

print(f"SUMMARY {sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)

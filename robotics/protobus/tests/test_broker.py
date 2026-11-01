"""M23 broker tests over real gRPC sockets: lease, setpoint TTL, command lifecycle, safety lane, quality."""
import asyncio
import contextlib
import json
import statistics
import time
import uuid

import grpc
import pytest

from protobus.broker.main import serve
from protobus.catalog import Catalog
from protobus.mock.provider import MockProvider
from protobus.provider_client import ProviderClient
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc
from protobus.wire import from_value, to_struct
from rss import rssc


@pytest.fixture(scope="module")
def catalog_path(tmp_path_factory):
    path = tmp_path_factory.mktemp("catalog") / "catalog.json"
    path.write_bytes(rssc.catalog_bytes(rssc.build("dog-go2-sim")))
    return str(path)


@contextlib.asynccontextmanager
async def stack(catalog_path, with_mock=True, audit_dir=None):
    service, server, safety = await serve(catalog_path, "127.0.0.1", 0, 0, audit_dir)
    target, safety_target = f"127.0.0.1:{service.bound_port}", f"127.0.0.1:{safety.bound_port}"
    mock = task = None
    if with_mock:
        mock = MockProvider(Catalog.load(catalog_path), target, safety_target)
        task = asyncio.ensure_future(mock.run())
        await asyncio.wait_for(mock.client.connected.wait(), 5)
        await asyncio.wait_for(mock.client.safety_connected.wait(), 5)
        await asyncio.sleep(0.2)
    channel = grpc.aio.insecure_channel(target)
    safety_channel = grpc.aio.insecure_channel(safety_target)
    try:
        yield {"broker": rpc.BrokerStub(channel), "safety": rpc.SafetyLaneStub(safety_channel), "mock": mock,
               "service": service, "target": target, "safety_target": safety_target}
    finally:
        if task:
            task.cancel()
        await channel.close()
        await safety_channel.close()
        await server.stop(0)
        safety.shutdown()


async def execute(broker, lease, path, args=None, request_id=None):
    request = pb.CommandRequest(lease_id=lease, path=path, args=to_struct(args or {}),
                                request_id=request_id or str(uuid.uuid4()))
    return [u async for u in broker.Execute(request)]


def phases(updates):
    return [pb.CommandPhase.Name(u.phase) for u in updates]


def run(coro):
    return asyncio.run(coro)


def test_get_samples_and_unknown_path(catalog_path):
    async def body():
        async with stack(catalog_path) as s:
            response = await s["broker"].Get(pb.GetRequest(paths=["Robot.Safety.Mode", "Robot.Leg.FrontLeft.*"]))
            values = {x.path: (from_value(x.value), x.quality) for x in response.samples}
            assert values["Robot.Safety.Mode"] == ("DISARMED", pb.OK)
            assert len(values) == 12
            with pytest.raises(grpc.aio.AioRpcError) as error:
                await s["broker"].Get(pb.GetRequest(paths=["Robot.Nope"]))
            assert error.value.code() == grpc.StatusCode.NOT_FOUND and "PB1101" in error.value.details()
    run(body())


def test_provider_with_wrong_catalog_is_refused(catalog_path):
    async def body():
        async with stack(catalog_path, with_mock=False) as s:
            client = ProviderClient(s["target"], s["safety_target"], "rogue", "sha256:" + "0" * 64,
                                    ["Robot.Safety.Mode"], None)
            task = asyncio.ensure_future(client._main_loop())
            for _ in range(50):
                if client.refused:
                    break
                await asyncio.sleep(0.05)
            task.cancel()
            assert client.refused and client.refused.startswith("PB1001")
    run(body())


def test_lease_is_exclusive_and_expires(catalog_path):
    async def body():
        async with stack(catalog_path) as s:
            broker = s["broker"]
            lease = await broker.AcquireControl(pb.AcquireRequest(client_id="app-1"))
            with pytest.raises(grpc.aio.AioRpcError) as error:
                await broker.AcquireControl(pb.AcquireRequest(client_id="app-2"))
            assert "PB1202" in error.value.details()
            await asyncio.sleep(0.15)
            assert s["mock"].model.controller == "WORKFLOW"
            await asyncio.sleep(1.1)  # no renew → expires
            assert s["mock"].model.controller == "NONE"
            second = await broker.AcquireControl(pb.AcquireRequest(client_id="app-2"))
            assert second.lease_id != lease.lease_id
            updates = await execute(broker, lease.lease_id, "Robot.Safety.Arm")
            assert phases(updates) == ["REJECTED"] and updates[0].code == "PB1201"
    run(body())


def test_setpoint_ttl_falls_back_to_safe_value(catalog_path):
    async def body():
        async with stack(catalog_path) as s:
            broker, model = s["broker"], s["mock"].model
            lease = (await broker.AcquireControl(pb.AcquireRequest(client_id="t"))).lease_id
            assert phases(await execute(broker, lease, "Robot.Safety.Arm")) == ["SUCCEEDED"]
            ack = await broker.SetSetpoint(pb.SetpointRequest(lease_id=lease, path="Robot.Motion.Velocity",
                                                              fields={"LinearX": 0.3, "AngularZ": 0.0}))
            assert ack.accepted and ack.expires_in_ms == 300
            sent = time.monotonic()
            await asyncio.sleep(0.05)
            assert model.cmd == (0.3, 0.0)
            while model.cmd != (0.0, 0.0) and time.monotonic() - sent < 1:
                await asyncio.sleep(0.005)
            elapsed = time.monotonic() - sent
            assert model.cmd == (0.0, 0.0) and 0.29 <= elapsed <= 0.40, elapsed
            assert model.x > 0.0
            bad = await broker.SetSetpoint(pb.SetpointRequest(lease_id=lease, path="Robot.Motion.Velocity",
                                                              fields={"LinearX": 0.9, "AngularZ": 0.0}))
            assert not bad.accepted and bad.code == "PB1302"
            missing = await broker.SetSetpoint(pb.SetpointRequest(lease_id=lease, path="Robot.Motion.Velocity",
                                                                  fields={"LinearX": 0.1}))
            assert missing.code == "PB1301"
            wrong_kind = await broker.SetSetpoint(pb.SetpointRequest(lease_id=lease, path="Robot.Safety.Mode",
                                                                     fields={"X": 1}))
            assert wrong_kind.code == "PB1102"
            audit = [e["kind"] for e in s["service"].audit.recent()]
            assert "setpoint.start" in audit and "setpoint.safe" in audit
    run(body())


def test_command_lifecycle_and_argument_checks(catalog_path):
    async def body():
        async with stack(catalog_path) as s:
            broker = s["broker"]
            lease = (await broker.AcquireControl(pb.AcquireRequest(client_id="t"))).lease_id
            rejected = await execute(broker, lease, "Robot.Motion.Perform", {"Name": "JUMP"})
            assert phases(rejected) == ["REJECTED"] and "MANUAL" in rejected[0].message
            await execute(broker, lease, "Robot.Safety.Arm")
            renew = asyncio.ensure_future(_keep_renewing(broker, lease))
            started = time.monotonic()
            jump = await execute(broker, lease, "Robot.Motion.Perform", {"Name": "JUMP"}, "jump-1")
            assert phases(jump) == ["ACCEPTED", "RUNNING", "SUCCEEDED"]
            assert 1.9 <= time.monotonic() - started <= 3.0
            duplicate = await execute(broker, lease, "Robot.Motion.Perform", {"Name": "JUMP"}, "jump-1")
            assert duplicate[0].code == "PB1402"
            bad = await execute(broker, lease, "Robot.Motion.Perform", {"Name": "MOONWALK"})
            assert bad[0].code == "PB1401"
            route = await execute(broker, lease, "Robot.Navigation.FollowRoute",
                                  {"Waypoints": [{"X": 0.3, "Y": 0.0}, {"X": 0.3, "Y": 0.3}]})
            assert phases(route)[-1] == "SUCCEEDED"
            assert s["mock"].model.route_done == 2
            renew.cancel()
    run(body())


class SilentHandler:
    async def on_command(self, *a): pass
    async def on_cancel(self, *a): pass
    async def on_setpoint(self, *a): pass
    async def on_control(self, *a): pass
    async def on_stop(self, request): return False


def test_command_timeout_and_provider_loss(catalog_path):
    async def body():
        async with stack(catalog_path, with_mock=False) as s:
            catalog = Catalog.load(catalog_path)
            silent = ProviderClient(s["target"], s["safety_target"], "silent", catalog.hash,
                                    ["Robot.Safety.Arm", "Robot.Motion.Perform"], SilentHandler())
            task = asyncio.ensure_future(silent._main_loop())
            await asyncio.wait_for(silent.connected.wait(), 5)
            broker = s["broker"]
            lease = (await broker.AcquireControl(pb.AcquireRequest(client_id="t"))).lease_id
            started = time.monotonic()
            renew = asyncio.ensure_future(_keep_renewing(broker, lease))
            timed_out = await execute(broker, lease, "Robot.Safety.Arm")
            assert phases(timed_out) == ["TIMED_OUT"] and timed_out[0].code == "PB1405"
            assert 2.9 <= time.monotonic() - started <= 3.5
            pending = asyncio.ensure_future(execute(broker, lease, "Robot.Motion.Perform", {"Name": "BOW"}))
            await asyncio.sleep(0.2)
            task.cancel()  # provider disappears mid-command
            lost = await asyncio.wait_for(pending, 5)
            assert phases(lost) == ["FAILED"] and lost[0].code == "PB1404"
            renew.cancel()
            sample = (await broker.Get(pb.GetRequest(paths=["Robot.Safety.Arm"]))).samples[0]
            assert sample.quality == pb.UNAVAILABLE
    run(body())


async def _keep_renewing(broker, lease):
    while True:
        await broker.RenewControl(pb.Lease(lease_id=lease))
        await asyncio.sleep(0.3)


def test_lease_expiry_cancels_running_command(catalog_path):
    async def body():
        async with stack(catalog_path) as s:
            broker = s["broker"]
            lease = (await broker.AcquireControl(pb.AcquireRequest(client_id="t"))).lease_id
            await execute(broker, lease, "Robot.Safety.Arm")
            updates = await execute(broker, lease, "Robot.Motion.Perform", {"Name": "WAVE_FRONT_LEFT"})
            assert phases(updates) == ["ACCEPTED", "RUNNING", "CANCELLED"] and updates[-1].code == "PB1406"
            model = s["mock"].model
            for _ in range(50):  # the provider applies the cancel asynchronously
                if model.motion_phase == "CANCELLED":
                    break
                await asyncio.sleep(0.01)
            assert model.mode == "MANUAL" and model.motion_phase == "CANCELLED"
    run(body())


def test_stop_is_confirmed_and_ends_control(catalog_path):
    async def body():
        async with stack(catalog_path) as s:
            broker, safety, model = s["broker"], s["safety"], s["mock"].model
            lease = (await broker.AcquireControl(pb.AcquireRequest(client_id="t"))).lease_id
            await execute(broker, lease, "Robot.Safety.Arm")
            await broker.SetSetpoint(pb.SetpointRequest(lease_id=lease, path="Robot.Motion.Velocity",
                                                        fields={"LinearX": 0.4, "AngularZ": 0.2}))
            result = await safety.Stop(pb.StopRequest(request_id="stop-1", source="CONTROL", reason="test"))
            assert result.confirmed and model.mode == "SAFE_STOP" and model.cmd == (0.0, 0.0)
            await asyncio.sleep(0.1)
            assert s["service"].control.lease is None
            via_execute = await execute(broker, "", "Robot.Safety.Stop")
            assert phases(via_execute) == ["SUCCEEDED"]
            arm = await execute(broker, (await broker.AcquireControl(pb.AcquireRequest(client_id="x"))).lease_id,
                                "Robot.Safety.Arm")
            assert phases(arm) == ["REJECTED"]
    run(body())


def test_stop_without_safety_provider_is_reported(catalog_path):
    async def body():
        async with stack(catalog_path, with_mock=False) as s:
            result = await s["safety"].Stop(pb.StopRequest(request_id="x", source="CONTROL"))
            assert not result.confirmed and result.code == "PB1502"
    run(body())


def test_stop_latency_under_telemetry_saturation(catalog_path):
    """2,000 samples/s + 20 subscribers + an unread subscriber: stop p99 must stay < 50 ms (ADR-0066)."""
    async def body():
        async with stack(catalog_path) as s:
            catalog = Catalog.load(catalog_path)
            joints = [p for p in catalog.leaves() if ".Joint." in p]
            loader = ProviderClient(s["target"], s["safety_target"], "loader", catalog.hash, [], SilentHandler())
            # The loader floods existing mock paths through the mock's own stream to stay within ownership rules.
            stop_flag = False

            async def flood():
                while not stop_flag:
                    s["mock"].client.publish({p: time.time() for p in joints[:20]})
                    await asyncio.sleep(0.01)

            async def subscriber(read=True):
                async with grpc.aio.insecure_channel(s["target"]) as channel:
                    stream = rpc.BrokerStub(channel).Subscribe(pb.SubscribeRequest(paths=["Robot.*"], max_rate_hz=20))
                    if not read:
                        await asyncio.sleep(30)
                    async for _ in stream:
                        if stop_flag:
                            break

            tasks = [asyncio.ensure_future(flood())] + [asyncio.ensure_future(subscriber()) for _ in range(20)]
            tasks.append(asyncio.ensure_future(subscriber(read=False)))
            await asyncio.sleep(1.0)
            latencies = []
            for index in range(40):
                started = time.perf_counter()
                result = await s["safety"].Stop(pb.StopRequest(request_id=f"load-{index}", source="CONTROL"))
                latencies.append((time.perf_counter() - started) * 1000)
                assert result.confirmed
                s["mock"].model.mode = "MANUAL"
                await asyncio.sleep(0.02)
            stop_flag = True
            for task in tasks:
                task.cancel()
            latencies.sort()
            p99 = latencies[int(len(latencies) * 0.99) - 1]
            print(json.dumps({"stopLatencyMs": {"p50": round(statistics.median(latencies), 2), "p99": round(p99, 2),
                                                "max": round(latencies[-1], 2)}}))
            assert p99 < 50, latencies
            del loader
    run(body())


def test_value_goes_stale_when_source_stops(catalog_path):
    async def body():
        async with stack(catalog_path, with_mock=False) as s:
            catalog = Catalog.load(catalog_path)
            client = ProviderClient(s["target"], s["safety_target"], "imu", catalog.hash,
                                    ["Robot.Imu.AngularVelocity.Z"], SilentHandler())
            task = asyncio.ensure_future(client._main_loop())
            await asyncio.wait_for(client.connected.wait(), 5)
            stream = s["broker"].Subscribe(pb.SubscribeRequest(paths=["Robot.Imu.AngularVelocity.Z"], max_rate_hz=50))
            source_alive = True

            async def source():
                while source_alive:
                    client.publish({"Robot.Imu.AngularVelocity.Z": 0.5})
                    await asyncio.sleep(0.02)

            feeder = asyncio.ensure_future(source())
            seen = []
            async for response in stream:
                seen += [x.quality for x in response.samples]
                if pb.OK in seen:
                    source_alive = False  # the source goes silent
                if pb.STALE in seen:
                    break
            feeder.cancel()
            assert seen[0] == pb.OK and seen[-1] == pb.STALE  # maxAgeMs 100 without new data
            task.cancel()
    run(body())

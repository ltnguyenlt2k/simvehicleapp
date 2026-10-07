"""The Velocitas host (velocitas-sdk 0.15.7, sdv.databroker.v1) with a fake broker and MQTT client: value
conversions, baselines, subscriptions by path, writes with errors, MQTT by filter, lifecycle trace lines."""

import asyncio
import io
import json
import os
import sys
from contextlib import redirect_stdout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

pytest.importorskip("velocitas_sdk")

from velocitas_sdk.proto.broker_pb2 import GetDatapointsReply, SetDatapointsReply, SubscribeReply  # noqa: E402
from velocitas_sdk.proto.types_pb2 import Datapoint, DatapointError, Uint32Array  # noqa: E402

from simvehicleapp_runtime import values as V  # noqa: E402
from simvehicleapp_runtime.velocitas import SimVehicleApp, from_sdk, to_sdk  # noqa: E402


def test_conversions():
    assert from_sdk(Datapoint(float_value=0.1)) == pytest.approx(0.1, rel=1e-7)
    assert from_sdk(Datapoint(bool_value=False)) is False
    assert from_sdk(Datapoint(uint32_array=Uint32Array(values=[1, 2]))) == [1, 2]
    assert from_sdk(Datapoint(failure_value=Datapoint.Failure.NOT_AVAILABLE)) is None
    assert from_sdk(Datapoint()) is None
    assert to_sdk("uint8", 7).WhichOneof("value") == "uint32_value"
    assert to_sdk("int16", -3).int32_value == -3
    assert to_sdk("float", V.fround(0.1)).WhichOneof("value") == "float_value"
    with pytest.raises(ValueError):
        to_sdk("uint8[]", [1])


class FakeBroker:
    def __init__(self):
        self.values = {"Vehicle.Speed": Datapoint(float_value=50.0)}
        self.sets = []
        self.queues = {}
        self.reject = set()

    async def GetDatapoints(self, paths):
        r = GetDatapointsReply()
        for p in paths:
            if p in self.values:
                r.datapoints[p].CopyFrom(self.values[p])
        return r

    async def SetDatapoints(self, datapoints):
        r = SetDatapointsReply()
        for p, dp in datapoints.items():
            self.sets.append((p, dp))
            if p in self.reject:
                r.errors[p] = DatapointError.OUT_OF_BOUNDS
        return r

    def Subscribe(self, query):
        async def stream():
            path = query.removeprefix("SELECT ")
            queue = self.queue(path)
            # Like the databroker: the first reply carries the current value (an empty datapoint when none).
            first = SubscribeReply()
            first.fields[path].CopyFrom(self.values.get(path, Datapoint()))
            yield first
            while True:
                value = await queue.get()
                reply = SubscribeReply()
                reply.fields[path].CopyFrom(value)
                yield reply

        return stream()

    def queue(self, path) -> asyncio.Queue:
        return self.queues.setdefault(path, asyncio.Queue())

    async def close(self):
        pass


class FakeMqtt:
    def __init__(self):
        self.subs = {}
        self.published = []

    async def subscribe_topic(self, topic, coro):
        self.subs[topic] = coro

    async def publish_event(self, topic, data):
        self.published.append((topic, data))


def bind(rt):
    w = rt.workflow("wf", "Hazard")
    speed = w.signal("s0", "Vehicle.Speed", "float")
    hazard = w.signal("s1", "Vehicle.Body.Lights.Hazard.IsSignaling", "boolean")
    topic = w.topic("t0", "hazard/cmd")
    out = w.topic("t1", "hazard/state")
    outs = {"previous": "float", "timestamp": "timestamp", "value": "float"}
    w.on_signal_changed(("n1", "b1"), speed, "any", None, 0, ("restart", 8, 4), outs, "n2")
    w.write(("n2", "b2"), hazard, lambda c: V.cast(V.compare(">", c.out("n1", "value"), 120), "boolean", "boolean"), True, "continue", {"error": "", "next": "n3"})
    w.publish(("n3", "b3"), out, lambda c: V.template("ok=", V.fmt(c.out("n2", "ok"), "boolean")), {"next": ""})
    w.on_mqtt(("n4", "b4"), topic, False, ("parallel", 8, 4), {"payload": "string", "topic": "string"}, "n5")
    w.log(("n5", "b5"), "info", lambda c: V.template("cmd ", c.out("n4", "payload")), {"next": ""})


def test_app_on_the_sdk_loop():
    async def go():
        app = SimVehicleApp.__new__(SimVehicleApp)
        broker, mqtt = FakeBroker(), FakeMqtt()
        app._vdb_client, app.pubsub_client = broker, mqtt
        hooks = []
        # VehicleApp.__init__ needs a live middleware: set up the host part only.
        app.app_name, app._binds = "HazardApp", [bind]
        app._on_app_start, app._on_app_stop = (lambda: hooks.append("start")), (lambda: hooks.append("stop"))
        from simvehicleapp_runtime.runtime import StdoutTraceSink
        from simvehicleapp_runtime.strand import MonotonicClock, Strand

        app.strand = Strand(MonotonicClock())
        app.sink = StdoutTraceSink("HazardApp", "trigger")
        app.runtime, app._vehicle, app._loop_task, app._stopping = None, None, None, False
        app.stop = lambda: asyncio.sleep(0)  # the SDK's stop (subscriptions, channel)

        await app.on_start()
        assert app.runtime._values["Vehicle.Speed"] == 50.0  # baseline: no trigger
        await broker.queue("Vehicle.Speed").put(Datapoint(float_value=130.0))
        await asyncio.sleep(0.1)
        broker.reject.add("Vehicle.Body.Lights.Hazard.IsSignaling")
        await broker.queue("Vehicle.Speed").put(Datapoint(float_value=140.0))
        await asyncio.sleep(0.1)
        await mqtt.subs["hazard/cmd"]("on")
        await asyncio.sleep(0.1)
        await app.shutdown()
        await asyncio.sleep(0)
        return broker, mqtt, hooks

    out = io.StringIO()
    with redirect_stdout(out):
        broker, mqtt, hooks = asyncio.run(go())
    assert [(p, dp.bool_value) for p, dp in broker.sets] == [("Vehicle.Body.Lights.Hazard.IsSignaling", True)] * 2
    assert mqtt.published == [("hazard/state", "ok=true"), ("hazard/state", "ok=false")]
    assert hooks == ["start", "stop"]
    lines = out.getvalue().splitlines()
    events = [json.loads(l[8:])["ev"] for l in lines if l.startswith("SVTRACE ")]
    assert events[:2] == ["vdb.connected", "app.started"] and events[-1] == "app.stopping"
    assert events.count("trigger") == 3 and "enter" not in events  # trace level "trigger"
    errors = [json.loads(l[8:]) for l in lines if '"ev":"error"' in l]
    assert errors[0]["data"] == {"reason": "write_failed", "message": "OUT_OF_BOUNDS"}
    assert "[info] cmd on" in lines

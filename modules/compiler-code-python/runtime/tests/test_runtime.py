"""Runtime behaviour outside the conformance cases: the strand, the stdout trace, the real-clock loop,
write errors and bounds, fresh reads with latency, MQTT delivery by subscription filter."""

import asyncio
import io
import json
import os
import sys
from contextlib import redirect_stdout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from simvehicleapp_runtime import values as V  # noqa: E402
from simvehicleapp_runtime.runtime import Runtime, StdoutTraceSink, TraceRecord, topic_matches  # noqa: E402
from simvehicleapp_runtime.strand import MonotonicClock, Strand  # noqa: E402
from simvehicleapp_runtime.testing import Bounds, MockPubSub, MockVehicle, RecordingSink, run_scenario  # noqa: E402

PARALLEL = ("parallel", 8, 4)
SPEED = {"previous": "float", "timestamp": "timestamp", "value": "float"}


def test_strand_orders_by_time_then_sequence_and_cancels():
    s = Strand()
    seen = []
    s.post_at(10, lambda: seen.append("b"))
    s.post_at(5, lambda: seen.append("a"))
    s.post_at(10, lambda: seen.append("c"))
    sid = s.post_at(7, lambda: seen.append("x"))
    s.cancel(sid)
    assert s.run_until(20) is True
    assert seen == ["a", "b", "c"]
    assert s.now_ms() == 20
    s.post_at(25, s.stop)
    s.post_at(30, lambda: seen.append("late"))
    assert s.run_until(40) is False
    assert "late" not in seen


def test_strand_real_clock_runs_due_events():
    async def go():
        s = Strand(MonotonicClock())
        seen = []
        s.post_at(s.now_ms() + 30, lambda: seen.append(s.now_ms()))
        s.post_at(s.now_ms() + 60, s.stop)
        await asyncio.wait_for(s.run(), 2)
        return seen

    seen = asyncio.run(go())
    assert len(seen) == 1 and seen[0] >= 30


def test_topic_filters():
    assert topic_matches("a/+/c", "a/b/c")
    assert topic_matches("a/#", "a/b/c")
    assert not topic_matches("a/+", "a/b/c")
    assert not topic_matches("a/b", "a/b/c")


def _hazard(rt: Runtime, await_ack=True, on_error="continue", error_next=""):
    w = rt.workflow("wf", "Hazard")
    speed = w.signal("s0", "Vehicle.Speed", "float")
    hazard = w.signal("s1", "Vehicle.Body.Lights.Hazard.IsSignaling", "boolean")
    w.on_signal_changed(("n1", "b1"), speed, "any", None, 0, PARALLEL, SPEED, "n2")
    nxt = {"next": "n3"}
    if error_next is not None:
        nxt["error"] = error_next
    w.write(("n2", "b2"), hazard, lambda c: V.cast(V.compare(">", c.out("n1", "value"), 120), "boolean", "boolean"), await_ack, on_error, nxt)
    w.log(("n3", "b3"), None, lambda c: V.template("ok=", V.fmt(c.out("n2", "ok"), "boolean")), {"next": ""})


def test_write_rejected_by_bounds_takes_on_error():
    def bind(rt):
        _hazard(rt)

    r = run_scenario(bind, {"until": 100, "inputs": [{"t": 10, "path": "Vehicle.Speed", "value": 130}]}, bounds={"Vehicle.Body.Lights.Hazard.IsSignaling": Bounds(allowed=[False])})
    errors = [e for e in r["trace"] if e["ev"] == "error"]
    assert errors and errors[0]["data"]["message"] == "true is outside the allowed values of Vehicle.Body.Lights.Hazard.IsSignaling"
    assert r["writes"] == []
    assert [l["message"] for l in r["logs"]] == ["ok=false"]  # continue: the next node sees ok=false


def test_write_error_stop_ends_the_run():
    def bind(rt):
        _hazard(rt, on_error="stop", error_next=None)

    r = run_scenario(bind, {"until": 100, "inputs": [{"t": 10, "path": "Vehicle.Speed", "value": 130}]}, bounds={"Vehicle.Body.Lights.Hazard.IsSignaling": Bounds(allowed=[False])})
    assert r["logs"] == []


def test_await_ack_waits_for_the_write_latency():
    def bind(rt):
        _hazard(rt)

    r = run_scenario(bind, {"until": 100, "latency": {"write": 25}, "inputs": [{"t": 10, "path": "Vehicle.Speed", "value": 130}]})
    assert r["writes"] == [{"t": 10, "path": "Vehicle.Body.Lights.Hazard.IsSignaling", "value": True}]
    assert r["logs"] == [{"t": 35, "level": "info", "message": "ok=true"}]


def test_fresh_read_and_missing_value():
    def bind(rt):
        w = rt.workflow("wf", "Read")
        speed = w.signal("s0", "Vehicle.Speed", "float")
        w.on_timer(("n1", "b1"), 50, 10, PARALLEL, {"tick": "uint32", "timestamp": "timestamp"}, "n2")
        w.read(("n2", "b2"), speed, True, {"next": "n3", "error": ""})
        w.log(("n3", "b3"), "info", lambda c: V.template("speed=", V.fmt(c.out("n2", "value"), "float")), {"next": ""})

    r = run_scenario(bind, {"until": 70, "latency": {"read": 5}, "inputs": [{"t": 40, "path": "Vehicle.Speed", "value": 0.1}]})
    errors = [e for e in r["trace"] if e["ev"] == "error"]
    assert errors[0]["ts"] == 15 and errors[0]["data"]["reason"] == "no_value"
    assert r["logs"] == [{"t": 65, "level": "info", "message": "speed=0.1"}]


def test_mqtt_delivery_by_subscription_filter_and_json_payload():
    strand = Strand()
    pubsub = MockPubSub(strand)
    sink = RecordingSink()
    rt = Runtime(strand, MockVehicle(strand), pubsub, sink)
    w = rt.workflow("wf", "Mqtt")
    t = w.topic("t0", "cmd/+/set")
    w.on_mqtt(("n1", "b1"), t, True, PARALLEL, {"payload": "json", "topic": "string"}, "n2")
    w.log(("n2", "b2"), None, lambda c: V.template(V.fmt(c.out("n1", "payload"), "json"), " on ", c.out("n1", "topic")), {"next": ""})
    rt.start()
    strand.run_until(0)
    # Velocitas gives the payload only: delivery to the triggers of that exact subscription (topic = filter).
    pubsub._handler("cmd/+/set", '{"on": 1}', "cmd/+/set")
    pubsub.inject("cmd/door/set", "not json")
    strand.run_until(10)
    assert [l["message"] for l in sink.logs] == ['{"on":1} on cmd/+/set']
    assert [r.data for r in sink.records if r.ev == "error"] == [{"reason": "payload_not_json", "topic": "cmd/door/set"}]


def test_stdout_trace_lines_and_levels(monkeypatch):
    out = io.StringIO()
    with redirect_stdout(out):
        StdoutTraceSink("HazardApp", "trigger").trace(TraceRecord(0, 5, "enter", "wf", 1, "n2", "b2", None))
        StdoutTraceSink("HazardApp", "trigger").trace(TraceRecord(1, 5, "trigger", "wf", 1, "n1", "b1", {"outputs": {"value": 130.0}}))
        StdoutTraceSink("HazardApp", "off").trace(TraceRecord(0, 5, "app.started", "", None, "", "", None))
        StdoutTraceSink("HazardApp", "node").log(5, "info", "hello")
    lines = out.getvalue().splitlines()
    assert len(lines) == 3
    first = json.loads(lines[0][len("SVTRACE ") :])
    assert lines[0].startswith("SVTRACE {")
    assert list(first) == ["v", "ts", "app", "wf", "run", "node", "ev", "data"]
    assert first["data"] == {"outputs": {"value": 130}} and "blockId" not in first
    assert json.loads(lines[1][len("SVTRACE ") :])["ev"] == "app.started"
    assert lines[2] == "[info] hello"
    monkeypatch.setenv("SV_TRACE_LEVEL", "off")
    assert StdoutTraceSink.level_from_env("node") == "off"
    monkeypatch.setenv("SV_TRACE_LEVEL", "node")
    assert StdoutTraceSink.level_from_env("trigger") == "trigger"  # the env never raises the level


def test_stop_app_stops_the_strand():
    def bind(rt):
        w = rt.workflow("wf", "Stop")
        w.on_timer(("n1", "b1"), 10, 10, PARALLEL, {"tick": "uint32", "timestamp": "timestamp"}, "n2")
        w.stop(("n2", "b2"), "app", {})

    r = run_scenario(bind, {"until": 100})
    assert [e["ev"] for e in r["trace"]] == ["trigger", "enter"]

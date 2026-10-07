"""Mock vehicle, mock MQTT and the scenario runner (C++ ``Testing.cpp``; ADR-0042 conformance P1).

``run_scenario(bind, scenario)`` runs a workflow on the virtual clock exactly like the reference simulator
replays a scenario: initial values are baselines, inputs are posted at their time before the app start, and
the result is the trace, the writes, the signals, the publishes and the logs as JSON values. Generated
pytest files (``app/tests/generated``) and the conformance runner both use it.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from . import values as V
from .runtime import PubSub, Runtime, TraceRecord, TraceSink, VehicleAccess
from .strand import Strand


class Bounds:
    def __init__(self, min: Optional[float] = None, max: Optional[float] = None, allowed: Optional[List[Any]] = None) -> None:
        self.min, self.max, self.allowed = min, max, allowed


class MockVehicle(VehicleAccess):
    def __init__(self, strand: Strand) -> None:
        self._strand = strand
        self._raw: Dict[str, Any] = {}
        self._values: Dict[str, Any] = {}
        self._types: Dict[str, str] = {}
        self._subs: Dict[str, List[Callable[[Any], None]]] = {}
        self._bounds: Dict[str, Bounds] = {}
        self._read_ms = 0
        self._write_ms = 0
        self.writes: List[Dict[str, Any]] = []
        self.signals: List[Dict[str, Any]] = []

    def set_initial(self, path: str, value: Any) -> None:
        self._raw[path] = value

    def set_latency(self, read_ms: int, write_ms: int) -> None:
        self._read_ms, self._write_ms = read_ms, write_ms

    def set_bounds(self, path: str, bounds: Bounds) -> None:
        self._bounds[path] = bounds

    def inject(self, path: str, raw: Any) -> None:
        type_ = self._types.get(path)
        if type_ is None:
            return  # a signal the app does not use
        v = V.from_json(raw, type_)
        self._values[path] = v
        self.signals.append({"t": self._strand.now_ms(), "path": path, "value": V.to_json(v, type_)})
        for cb in list(self._subs.get(path, [])):
            cb(v)

    def current(self, path: str, type_: str) -> Optional[Any]:
        self._types[path] = type_
        if path not in self._raw:
            return None
        self._values[path] = V.from_json(self._raw[path], type_)
        return self._values[path]

    def subscribe(self, path: str, type_: str, on_value: Callable[[Any], None]) -> None:
        self._types[path] = type_
        self._subs.setdefault(path, []).append(on_value)

    def get(self, path: str, type_: str, done: Callable[[Optional[Any], str], None]) -> None:
        self._strand.post_at(self._strand.now_ms() + self._read_ms, lambda: done(self._values.get(path), ""))

    def check_write(self, path: str, type_: str, value: Any) -> str:
        b = self._bounds.get(path)
        if b is None:
            return ""
        numeric = V.is_number(value)
        n = V.num(value) if numeric else 0.0
        bad = (b.min is not None and numeric and n < b.min) or (b.max is not None and numeric and n > b.max)
        if not bad and b.allowed is not None:
            bad = not any(_text(x) == _text(value) for x in b.allowed)
        if not bad:
            return ""
        return f"{_text(V.to_json(value, type_))} is outside the allowed values of {path}"

    def set(self, path: str, type_: str, value: Any, done: Optional[Callable[[str], None]]) -> None:
        # An actuator write sets its target; the current value changes only when the vehicle reports it.
        self.writes.append({"t": self._strand.now_ms(), "path": path, "value": V.to_json(value, type_)})
        if done is not None:
            self._strand.post_at(self._strand.now_ms() + self._write_ms, lambda: done(""))


def _text(v: Any) -> str:
    """``String(x)`` of a JSON value (allowed values are compared as text, like the simulator)."""
    return v if isinstance(v, str) else V.fmt(v)


class MockPubSub(PubSub):
    def __init__(self, strand: Strand) -> None:
        self._strand = strand
        self._handler: Optional[Callable[[str, str, Optional[str]], None]] = None
        self.publishes: List[Dict[str, Any]] = []

    def inject(self, topic: str, payload: str) -> None:
        if self._handler is not None:
            self._handler(topic, payload, None)

    def set_handler(self, handler: Callable[[str, str, Optional[str]], None]) -> None:
        self._handler = handler

    def subscribe(self, topic_filter: str) -> None:
        pass

    def publish(self, topic: str, payload: str) -> None:
        self.publishes.append({"t": self._strand.now_ms(), "topic": topic, "payload": payload})
        self.inject(topic, payload)


class RecordingSink(TraceSink):
    def __init__(self) -> None:
        self.records: List[TraceRecord] = []
        self.logs: List[Dict[str, Any]] = []

    def trace(self, record: TraceRecord) -> None:
        self.records.append(record)

    def log(self, ts: int, level: str, message: str) -> None:
        self.logs.append({"t": ts, "level": level, "message": message})


def run_scenario(bind: Callable[[Runtime], None], scenario: Dict[str, Any], run_id: str = "sim", bounds: Optional[Dict[str, Bounds]] = None) -> Dict[str, List[Any]]:
    strand = Strand()
    vehicle = MockVehicle(strand)
    pubsub = MockPubSub(strand)
    sink = RecordingSink()
    rt = Runtime(strand, vehicle, pubsub, sink)
    bind(rt)

    for path, value in (scenario.get("initial") or {}).items():
        vehicle.set_initial(path, value)
    latency = scenario.get("latency")
    if latency:
        vehicle.set_latency(int(latency.get("read", 0)), int(latency.get("write", 0)))
    for path, b in (bounds or {}).items():
        vehicle.set_bounds(path, b)
    # Inputs first (lowest sequence at each instant), then the app start — simulator order.
    for inp in scenario.get("inputs") or []:
        t = int(inp["t"])
        if "topic" in inp:
            value = inp["value"]
            payload = value if isinstance(value, str) else V.js_json(value)
            strand.post_at(t, lambda topic=inp["topic"], payload=payload: pubsub.inject(topic, payload))
        else:
            strand.post_at(t, lambda path=inp["path"], value=inp["value"]: vehicle.inject(path, value))
    rt.start()
    strand.run_until(int(scenario["until"]))

    trace = []
    for r in sink.records:
        e: Dict[str, Any] = {"runId": run_id, "seq": r.seq, "ts": r.ts, "ev": r.ev}
        if r.wf:
            e["wf"] = r.wf
        if r.run is not None:
            e["run"] = r.run
        if r.node:
            e["node"] = r.node
        if r.block_id:
            e["blockId"] = r.block_id
        if r.data is not None:
            e["data"] = r.data
        trace.append(e)
    return {"trace": trace, "writes": vehicle.writes, "signals": vehicle.signals, "publishes": pubsub.publishes, "logs": sink.logs}


def _subset(want: Any, have: Any) -> bool:
    if isinstance(want, dict):
        if not isinstance(have, dict):
            return False
        return all(k in have and _subset(v, have[k]) for k, v in want.items())
    return V.js_json(want) == V.js_json(have)


def check_expectations(result: Dict[str, List[Any]], expect: Optional[Dict[str, Any]]) -> List[str]:
    """Problems of a result against ``scenario.expect`` (writes exactly, trace matchers in order)."""
    out: List[str] = []
    if not expect:
        return out
    if "writes" in expect:
        have = [{"t": w["t"], "path": w["path"], "value": w["value"]} for w in result["writes"]]
        if V.js_json(have) != V.js_json(expect["writes"]):
            out.append(f"writes differ:\n  expected {V.js_json(expect['writes'])}\n  actual   {V.js_json(have)}")
    if "trace" in expect:
        i = 0
        trace = result["trace"]
        for m in expect["trace"]:
            while i < len(trace) and not _subset(m, trace[i]):
                i += 1
            if i == len(trace):
                out.append(f"trace event {V.js_json(m)} not found (in order)")
                break
            i += 1
    return out

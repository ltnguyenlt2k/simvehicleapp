"""SimVehicleApp runtime for Python vehicle apps (ADR-0040 §2; execution semantics ADR-0012 + ADR-0017 Notes;
executable spec: conformance C01…C38 and the golden traces).

A port of the C++ runtime (``compiler-code-cpp/runtime/src/Runtime.cpp``), itself the reference simulator's
model: generated code declares each workflow with a ``Workflow`` builder — one call per IR trigger and node,
expressions as lambdas over a ``Ctx`` — and the runtime executes it on one strand. A run is a set of fibers
(the trigger's chain plus parallel branches) sharing a cancel token; a fiber runs synchronously until it
waits, then continues (its continuation ``k``) from a strand event. Timing, concurrency policies,
cancellation and tracing live here once instead of in every generated file.
"""

from __future__ import annotations

import json
import os
import sys
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import values as V
from .strand import Strand, epoch_ms
from .values import EvalError

Expr = Callable[["Ctx"], Any]
Cond = Callable[["Ctx"], bool]
#: IR identity of a trigger or node: (``nK``, block id).
Node = Tuple[str, str]
#: Output handle → next node id; "" ends the run (IR ``next``).
Next = Dict[str, str]
#: (policy, queueMax, maxRuns) — IR ``concurrency``, default parallel/8/4.
Concurrency = Tuple[str, int, int]


class SignalRef:
    __slots__ = ("id", "path", "type")

    def __init__(self, id: str, path: str, type: str) -> None:
        self.id, self.path, self.type = id, path, type


class TopicRef:
    __slots__ = ("id", "topic")

    def __init__(self, id: str, topic: str) -> None:
        self.id, self.topic = id, topic


class StateRef:
    __slots__ = ("id", "type")

    def __init__(self, id: str, type: str) -> None:
        self.id, self.type = id, type


# ---- ports ------------------------------------------------------------------------------------------------------


class VehicleAccess:
    """The databroker as the runtime sees it (C++ ``IVehicleAccess``)."""

    def current(self, path: str, type_: str) -> Optional[Any]:
        raise NotImplementedError

    def subscribe(self, path: str, type_: str, on_value: Callable[[Any], None]) -> None:
        raise NotImplementedError

    def get(self, path: str, type_: str, done: Callable[[Optional[Any], str], None]) -> None:
        raise NotImplementedError

    def check_write(self, path: str, type_: str, value: Any) -> str:
        return ""

    def set(self, path: str, type_: str, value: Any, done: Optional[Callable[[str], None]]) -> None:
        raise NotImplementedError


class PubSub:
    """MQTT as the runtime sees it; the handler gets (topic, payload, only_filter)."""

    def set_handler(self, handler: Callable[[str, str, Optional[str]], None]) -> None:
        raise NotImplementedError

    def subscribe(self, topic_filter: str) -> None:
        raise NotImplementedError

    def publish(self, topic: str, payload: str) -> None:
        raise NotImplementedError


class TraceRecord:
    __slots__ = ("seq", "ts", "ev", "wf", "run", "node", "block_id", "data")

    def __init__(self, seq: int, ts: int, ev: str, wf: str, run: Optional[int], node: str, block_id: str, data: Optional[Dict[str, Any]]) -> None:
        self.seq, self.ts, self.ev, self.wf, self.run, self.node, self.block_id, self.data = seq, ts, ev, wf, run, node, block_id, data


class TraceSink:
    def trace(self, record: TraceRecord) -> None:
        raise NotImplementedError

    def log(self, ts: int, level: str, message: str) -> None:
        raise NotImplementedError


TRACE_LEVELS = {"off": 0, "trigger": 1, "node": 2}
_stdout_lock = threading.Lock()


class StdoutTraceSink(TraceSink):
    """``SVTRACE {json}`` lines on stdout (ADR-0021 §7, contracts trace-event ``runtimeLine``)."""

    def __init__(self, app: str, level: str = "node") -> None:
        self.app = app
        self.level = TRACE_LEVELS.get(level, 2)

    @staticmethod
    def level_from_env(fallback: str = "node") -> str:
        """The env can lower the level the project was generated with, never raise it (analysis/08 §3.2)."""
        env = os.environ.get("SV_TRACE_LEVEL", "")
        if env in TRACE_LEVELS and TRACE_LEVELS[env] < TRACE_LEVELS.get(fallback, 2):
            return env
        return fallback

    def trace(self, r: TraceRecord) -> None:
        # Lifecycle events (`app.*`, `vdb.*`) are always written: a live run needs them at every level.
        lifecycle = r.ev.startswith("app.") or r.ev.startswith("vdb.")
        if not lifecycle and (self.level == 0 or (self.level == 1 and r.ev in ("enter", "exit"))):
            return
        line: Dict[str, Any] = {"v": 1, "ts": epoch_ms(), "app": self.app}
        if r.wf:
            line["wf"] = r.wf
        if r.run is not None:
            line["run"] = r.run
        if r.node:
            line["node"] = r.node
        line["ev"] = r.ev
        if r.data is not None:
            line["data"] = r.data
        self._write("SVTRACE " + V.js_json(line) + "\n")

    def log(self, ts: int, level: str, message: str) -> None:
        self._write(f"[{level}] {message}\n")

    @staticmethod
    def _write(text: str) -> None:
        with _stdout_lock:
            sys.stdout.write(text)
            sys.stdout.flush()


# ---- engine state -----------------------------------------------------------------------------------------------


class _Token:
    __slots__ = ("cancelled", "children")

    def __init__(self) -> None:
        self.cancelled = False
        self.children: List[_Token] = []

    def cancel(self) -> None:
        if self.cancelled:
            return
        self.cancelled = True
        for c in self.children:
            c.cancel()

    @staticmethod
    def child(parent: Optional["_Token"]) -> "_Token":
        t = _Token()
        if parent is not None:
            ch = parent.children
            # Long-running apps: drop tokens of finished runs now and then.
            if len(ch) >= 64 and (len(ch) & (len(ch) - 1)) == 0:
                ch[:] = [c for c in ch if not c.cancelled]
            ch.append(t)
        return t


class _TriggerDef:
    def __init__(self, wf: "Workflow", node: Node, kind: str, c: Concurrency, outputs: Dict[str, str], entry: str) -> None:
        self.id, self.block_id = node
        self.kind = kind
        self.wf = wf
        self.policy, self.queue_max, self.max_runs = c
        self.outputs = outputs
        self.entry = entry
        self.signal: Optional[SignalRef] = None
        self.mode = "any"
        self.threshold: Any = None
        self.has_threshold = False
        self.debounce_ms = 0
        self.interval_ms = 0
        self.initial_delay_ms = 0
        self.condition: Optional[Cond] = None
        self.topic: Optional[TopicRef] = None
        self.json_payload = False


class _NodeDef:
    def __init__(self, node: Node, kind: str, next: Next) -> None:
        self.id, self.block_id = node
        self.kind = kind
        self.next = dict(next)
        self.signal: Optional[SignalRef] = None
        self.topic: Optional[TopicRef] = None
        self.state: Optional[StateRef] = None
        self.value: Optional[Expr] = None
        self.low: Optional[Expr] = None
        self.high: Optional[Expr] = None
        self.cases: List[Expr] = []
        self.condition: Optional[Cond] = None
        self.ms = 0
        self.count = 0
        self.max_iterations = 0
        self.flag = False  # fresh / awaitAck / hysteresis
        self.on_error = "continue"
        self.has_on_error = False
        self.body = ""
        self.branches: List[str] = []
        self.join = "all"
        self.scope = "run"
        self.counter_op = "inc"
        self.filter_mode = ""
        self.alpha = 0.0
        self.level: Optional[str] = None
        self.output = ""


class _FilterState:
    def __init__(self) -> None:
        self.window: List[float] = []
        self.y = 0.0
        self.count = 0


class _Run:
    def __init__(self, n: int, trigger: _TriggerDef, token: _Token) -> None:
        self.n = n
        self.trigger = trigger
        self.token = token
        self.outputs: Dict[str, Dict[str, Any]] = {}
        self.fibers: Dict["_Fiber", None] = {}
        self.finished = False


OK, TIMEOUT, DONE = "ok", "timeout", "done"
Cont = Callable[[Optional[str]], None]


class _Fiber:
    __slots__ = ("run", "order", "token", "done", "waiters", "on_done", "k")

    def __init__(self, run: _Run, order: int, token: _Token) -> None:
        self.run = run
        self.order = order
        self.token = token
        self.done = False
        self.waiters: List[Callable[[], None]] = []
        self.on_done: Optional[Callable[[], None]] = None
        self.k: Optional[Cont] = None


class _Waiter:
    __slots__ = ("fiber", "wf", "cond", "want_true", "timer", "active")

    def __init__(self, fiber: _Fiber, wf: "Workflow", cond: Optional[Cond], want_true: bool) -> None:
        self.fiber, self.wf, self.cond, self.want_true = fiber, wf, cond, want_true
        self.timer = 0
        self.active = True


class _StopRun(Exception):
    """Thrown by ``stop``/the loop guard: ends the fiber."""


# ---- Ctx -------------------------------------------------------------------------------------------------------


class Ctx:
    """Evaluation context of an expression: the current run (if any) and the app state."""

    __slots__ = ("_rt", "_wf", "_run")

    def __init__(self, rt: "Runtime", wf: "Workflow", run: Optional[_Run]) -> None:
        self._rt, self._wf, self._run = rt, wf, run

    def out(self, node: str, output: str) -> Any:
        """Output ``output`` of trigger/node ``node`` in this run; missing ⇒ ``no_value`` (ADR-0017 Notes §14)."""
        if self._run is not None:
            o = self._run.outputs.get(node)
            if o is not None:
                v = o.get(output)
                if v is not None:
                    return v
        raise EvalError("no_value", f"{node}.{output} has no value")

    def signal(self, s: SignalRef) -> Any:
        v = self._rt._values.get(s.path)
        if v is None:
            raise EvalError("no_value", f"signal {s.id} has no value yet")
        return v

    def state(self, v: StateRef) -> Any:
        return self._wf._state.get(v.id)

    def now_ms(self) -> int:
        return self._rt.strand.now_ms()


# ---- Workflow builder ---------------------------------------------------------------------------------------


class Workflow:
    """Builder of one workflow (one generated module); every call mirrors one IR trigger or node."""

    def __init__(self, rt: "Runtime", id: str, name: str) -> None:
        self._rt = rt
        self.id = id
        self.name = name
        self._triggers: List[_TriggerDef] = []
        self._nodes: Dict[str, _NodeDef] = {}
        self._state: Dict[str, Any] = {}
        self._state_initial: Dict[str, Any] = {}
        self._state_type: Dict[str, str] = {}

    def signal(self, id: str, path: str, type: str) -> SignalRef:
        """A VSS signal of the workflow (IR ``signals[]``): id, path, VSS datatype."""
        self._rt._path_type.setdefault(path, type)
        return SignalRef(id, path, type)

    def topic(self, id: str, topic: str) -> TopicRef:
        return TopicRef(id, topic)

    def state(self, id: str, type: str, initial: Any) -> StateRef:
        """A workflow variable shared by all runs of the app; ``initial`` is its JSON value."""
        self._state_initial[id] = initial
        self._state[id] = V.from_json(initial, type)
        self._state_type[id] = type
        return StateRef(id, type)

    def _trigger(self, n: Node, kind: str, c: Concurrency, outputs: Dict[str, str], entry: str) -> _TriggerDef:
        t = _TriggerDef(self, n, kind, c, outputs, entry)
        self._triggers.append(t)
        return t

    def _add(self, n: Node, kind: str, next: Next) -> _NodeDef:
        d = _NodeDef(n, kind, next)
        self._nodes[d.id] = d
        return d

    # -- triggers
    def on_app_start(self, n: Node, c: Concurrency, outputs: Dict[str, str], entry: str) -> None:
        """``event.app_start``: one run when the app starts."""
        self._trigger(n, "app_start", c, outputs, entry)

    def on_signal_changed(self, n: Node, s: SignalRef, mode: str, threshold: Any, debounce_ms: int, c: Concurrency, outputs: Dict[str, str], entry: str) -> None:
        """``event.signal_changed``: a run per change of ``s`` matching ``mode`` (vs ``threshold``), after ``debounce_ms``."""
        t = self._trigger(n, "signal_changed", c, outputs, entry)
        t.signal = s
        t.mode = mode
        t.threshold = threshold
        t.has_threshold = threshold is not None
        t.debounce_ms = debounce_ms

    def on_timer(self, n: Node, interval_ms: int, initial_delay_ms: int, c: Concurrency, outputs: Dict[str, str], entry: str) -> None:
        """``event.timer``: ticks every ``interval_ms`` from ``initial_delay_ms`` (ticks skipped by the policy still count)."""
        t = self._trigger(n, "timer", c, outputs, entry)
        t.interval_ms = interval_ms
        t.initial_delay_ms = initial_delay_ms

    def on_condition(self, n: Node, condition: Optional[Cond], debounce_ms: int, c: Concurrency, outputs: Dict[str, str], entry: str) -> None:
        """``event.condition``: a run when ``condition`` becomes true (rising edge), held ``debounce_ms``."""
        t = self._trigger(n, "condition", c, outputs, entry)
        t.condition = condition
        t.debounce_ms = debounce_ms

    def on_mqtt(self, n: Node, topic: TopicRef, json_payload: bool, c: Concurrency, outputs: Dict[str, str], entry: str) -> None:
        """``event.mqtt_message``: a run per message on ``topic`` (``+``/``#`` filters); JSON payloads are parsed."""
        t = self._trigger(n, "mqtt", c, outputs, entry)
        t.topic = topic
        t.json_payload = json_payload

    # -- nodes
    def read(self, n: Node, s: SignalRef, fresh: bool, next: Next) -> None:
        d = self._add(n, "read", next)
        d.signal = s
        d.flag = fresh

    def write(self, n: Node, s: SignalRef, value: Expr, await_ack: bool, on_error: str, next: Next) -> None:
        d = self._add(n, "write", next)
        d.signal = s
        d.value = value
        d.flag = await_ack
        d.on_error = on_error
        d.has_on_error = True

    def branch(self, n: Node, condition: Optional[Cond], next: Next) -> None:
        self._add(n, "branch", next).condition = condition

    def switch(self, n: Node, value: Expr, cases: List[Expr], next: Next) -> None:
        d = self._add(n, "switch", next)
        d.value = value
        d.cases = cases

    def wait(self, n: Node, duration_ms: int, next: Next) -> None:
        self._add(n, "wait", next).ms = duration_ms

    def wait_until(self, n: Node, condition: Optional[Cond], timeout_ms: int, next: Next) -> None:
        d = self._add(n, "wait_until", next)
        d.condition = condition
        d.ms = timeout_ms

    def stable_for(self, n: Node, condition: Optional[Cond], duration_ms: int, next: Next) -> None:
        d = self._add(n, "stable_for", next)
        d.condition = condition
        d.ms = duration_ms

    def repeat(self, n: Node, count: int, interval_ms: int, body: str, next: Next) -> None:
        d = self._add(n, "repeat", next)
        d.count = count
        d.ms = interval_ms
        d.body = body

    def while_loop(self, n: Node, condition: Optional[Cond], max_iterations: int, interval_ms: int, body: str, next: Next) -> None:
        d = self._add(n, "while", next)
        d.condition = condition
        d.max_iterations = max_iterations
        d.ms = interval_ms
        d.body = body

    def parallel(self, n: Node, branches: List[str], join: str, next: Next) -> None:
        d = self._add(n, "parallel", next)
        d.branches = branches
        d.join = join

    def stop(self, n: Node, scope: str, next: Next) -> None:
        self._add(n, "stop", next).scope = scope

    def state_get(self, n: Node, v: StateRef, next: Next) -> None:
        self._add(n, "state_get", next).state = v

    def state_set(self, n: Node, v: StateRef, value: Expr, next: Next) -> None:
        d = self._add(n, "state_set", next)
        d.state = v
        d.value = value

    def counter(self, n: Node, v: StateRef, op: str, step: int, next: Next) -> None:
        d = self._add(n, "counter", next)
        d.state = v
        d.counter_op = op
        d.count = step

    def eval(self, n: Node, output: str, value: Expr, next: Next) -> None:
        d = self._add(n, "eval", next)
        d.output = output
        d.value = value

    def in_range(self, n: Node, value: Expr, low: Expr, high: Expr, hysteresis: bool, next: Next) -> None:
        d = self._add(n, "in_range", next)
        d.value, d.low, d.high = value, low, high
        d.flag = hysteresis

    def filter(self, n: Node, value: Expr, mode: str, window: int, alpha: float, next: Next) -> None:
        """`state.filter` (ADR-0049 §1): moving-average / median over `window` samples, or exponential (`alpha`)."""
        d = self._add(n, "filter", next)
        d.value = value
        d.filter_mode = mode
        d.count = window
        d.alpha = alpha

    def log(self, n: Node, level: Optional[str], message: Expr, next: Next) -> None:
        d = self._add(n, "log", next)
        d.level = level
        d.value = message

    def publish(self, n: Node, topic: TopicRef, payload: Expr, next: Next) -> None:
        d = self._add(n, "publish", next)
        d.topic = topic
        d.value = payload


# ---- helpers -------------------------------------------------------------------------------------------------


def topic_matches(flt: str, topic: str) -> bool:
    f = flt.split("/")
    t = topic.split("/")
    for i, part in enumerate(f):
        if part == "#":
            return True
        if part != "+" and (i >= len(t) or part != t[i]):
            return False
    return len(f) == len(t)


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _text(v: Any) -> str:
    """``formatValue(v, "")`` of the C++ runtime: strings as they are, other values as the simulator prints them."""
    return v if isinstance(v, str) else V.fmt(v)


def _same_value(a: Any, b: Any, a_present: bool = True) -> bool:
    """``eq`` of the simulator: undefined never equals; integers by decimal text; objects never ``===``."""
    if not a_present:
        return False
    if a is None or b is None:
        return a is None and b is None
    if _is_int(a) or _is_int(b):
        return _text(a) == _text(b)
    if isinstance(a, (list, dict)):
        return False
    if isinstance(a, float) and isinstance(b, float):
        return a == b
    return type(a) is type(b) and a == b


def _switch_match(v: Any, c: Any) -> bool:
    """``control.switch`` case equality (simulator rule: integers exactly, numbers by value, else strict)."""
    if _is_int(v) or _is_int(c):
        if _text(v) == _text(c) and not isinstance(c, str):
            return True
        return not isinstance(v, str) and V.num(v) == V.num(c)
    if isinstance(v, float) and isinstance(c, float):
        return v == c
    if type(v) is not type(c) or isinstance(v, (list, dict)):
        return False
    return v == c


def _js_parse(text: str) -> Any:
    """``JSON.parse``: numbers become floats like in JavaScript."""

    def fix(x: Any) -> Any:
        if _is_int(x):
            return float(x)
        if isinstance(x, list):
            return [fix(y) for y in x]
        if isinstance(x, dict):
            return {k: fix(y) for k, y in x.items()}
        return x

    return fix(json.loads(text))


# ---- runtime --------------------------------------------------------------------------------------------------


class Runtime:
    """The app: workflows, signal cache, scheduler of runs. One per process (``SimVehicleApp``) or per test."""

    def __init__(self, strand: Strand, vehicle: VehicleAccess, pubsub: PubSub, sink: TraceSink) -> None:
        self.strand = strand
        self.vehicle = vehicle
        self.pubsub = pubsub
        self.sink = sink
        self._workflows: List[Workflow] = []
        self._values: Dict[str, Any] = {}
        self._path_type: Dict[str, str] = {}
        self._trace_seq = 0
        self._app_token = _Token()
        # workflow → trigger → its runs, in the order the triggers first ran (Map semantics of the simulator)
        self._runs_of: Dict[str, Dict[_TriggerDef, List[_Run]]] = {}
        self._queues: Dict[_TriggerDef, List[Callable[[], None]]] = {}
        self._waiters: List[_Waiter] = []
        self._condition_last: Dict[_TriggerDef, bool] = {}
        self._debounce: Dict[_TriggerDef, int] = {}
        self._hysteresis: Dict[str, bool] = {}
        self._filters: Dict[str, _FilterState] = {}
        self._subscribed: set = set()
        self._current: Optional[_Fiber] = None
        self._fiber_count = 0
        self.run_count = 0
        self.stopped = False

    def workflow(self, id: str, name: str) -> Workflow:
        """Declares a workflow (generated ``bind``); workflows run in declaration order."""
        w = Workflow(self, id, name)
        self._workflows.append(w)
        return w

    def start(self) -> None:
        """Reads the baselines, subscribes signals and topics, posts the app start on the strand."""
        paths = sorted(self._path_type.items())
        for path, type_ in paths:
            v = self.vehicle.current(path, type_)
            if v is not None:
                self._values[path] = v
        for path, type_ in paths:
            self.vehicle.subscribe(path, type_, lambda v, p=path: self._apply_input(p, v))
        self.pubsub.set_handler(self._deliver_mqtt)
        for t in self._triggers():
            if t.kind == "mqtt" and t.topic.topic not in self._subscribed:
                self._subscribed.add(t.topic.topic)
                self.pubsub.subscribe(t.topic.topic)
        self.strand.post_at(0, self._start_app)

    def stop_all(self) -> None:
        """Cancels every run; the strand keeps running other events."""
        self.stopped = True
        self._app_token.cancel()

    def trace_lifecycle(self, ev: str, data: Optional[Dict[str, Any]] = None) -> None:
        """``vdb.connected``, ``app.started``, ``app.stopping`` (no workflow, no run)."""
        self._trace(ev, None, "", "", "", data)

    # ---- helpers
    def _now(self) -> int:
        return self.strand.now_ms()

    def _schedule(self, at: int, fn: Callable[[], None]) -> int:
        return self.strand.post_at(at, fn)

    def _triggers(self) -> List[_TriggerDef]:
        return [t for w in self._workflows for t in w._triggers]

    # ---- tracing
    def _trace(self, ev: str, run: Optional[_Run], wf: str, node: str, block_id: str, data: Optional[Dict[str, Any]] = None) -> None:
        seq = self._trace_seq
        self._trace_seq += 1
        has = run is not None or node != ""
        run_n = (run.n if run is not None else 0) if has else None
        self.sink.trace(TraceRecord(seq, self._now(), ev, wf if has else "", run_n, node, block_id, data))

    def _trace_node(self, ev: str, run: _Run, node: _NodeDef, data: Optional[Dict[str, Any]] = None) -> None:
        self._trace(ev, run, run.trigger.wf.id, node.id, node.block_id, data)

    # ---- inputs, signals, triggers
    def _start_app(self) -> None:
        for t in self._triggers():
            if t.kind == "app_start":
                self._fire(t, {})
            if t.kind == "timer":
                self._schedule_tick(t, t.initial_delay_ms, 1)
            if t.kind == "condition":
                self._condition_last[t] = self._safe_cond(t.wf, None, t.condition)

    def _schedule_tick(self, t: _TriggerDef, at: int, tick: int) -> None:
        def fire() -> None:
            self._fire(t, {"tick": tick, "timestamp": self._now()})
            self._schedule_tick(t, at + t.interval_ms, tick + 1)

        self._schedule(at, fire)

    def _mode_matches(self, t: _TriggerDef, prev: Any, has_prev: bool, nxt: Any) -> bool:
        n = V.num
        th = t.threshold if t.has_threshold else float("nan")
        m = t.mode
        if m == "any":
            return not _same_value(prev, nxt, has_prev)
        if m == "rising":
            return has_prev and n(nxt) > n(prev)
        if m == "falling":
            return has_prev and n(nxt) < n(prev)
        if m == "crosses_above":
            return has_prev and n(prev) <= n(th) < n(nxt)
        if m == "crosses_below":
            return has_prev and n(prev) >= n(th) > n(nxt)
        if m == "becomes":
            return t.has_threshold and _same_value(nxt, th) and not _same_value(prev, th, has_prev)
        return False

    def _apply_input(self, path: str, incoming: Any) -> None:
        if path not in self._path_type:
            return  # a signal the app does not use
        has_prev = path in self._values
        prev = self._values.get(path)
        nxt = incoming
        self._values[path] = nxt
        for t in self._triggers():
            if t.kind != "signal_changed" or t.signal.path != path:
                continue
            if not self._mode_matches(t, prev, has_prev, nxt):
                continue
            outputs = {"value": nxt, "previous": prev if has_prev else None, "timestamp": self._now()}
            if t.debounce_ms > 0:
                old = self._debounce.get(t)
                if old is not None:
                    self.strand.cancel(old)

                def later(t: _TriggerDef = t, outputs: Dict[str, Any] = outputs) -> None:
                    self._debounce.pop(t, None)
                    o = dict(outputs)
                    o["value"] = self._values.get(path)
                    o["timestamp"] = self._now()
                    self._fire(t, o)

                self._debounce[t] = self._schedule(self._now() + t.debounce_ms, later)
            else:
                self._fire(t, outputs)
        self._after_change()

    def _after_change(self) -> None:
        """After a signal/state change: condition triggers (rising edge) and waiting fibers."""
        for t in self._triggers():
            if t.kind != "condition":
                continue
            now_true = self._safe_cond(t.wf, None, t.condition)
            before = self._condition_last.get(t, False)
            self._condition_last[t] = now_true
            if now_true and not before:
                if t.debounce_ms > 0:

                    def later(t: _TriggerDef = t) -> None:
                        self._debounce.pop(t, None)
                        if self._safe_cond(t.wf, None, t.condition):
                            self._fire(t, {"timestamp": self._now()})

                    self._debounce[t] = self._schedule(self._now() + t.debounce_ms, later)
                else:
                    self._fire(t, {"timestamp": self._now()})
            elif not now_true:
                sid = self._debounce.pop(t, None)
                if sid is not None:
                    self.strand.cancel(sid)
        for w in list(self._waiters):
            # A nested change (a resumed run that sets state) may already have resumed or dropped it.
            if not w.active:
                continue
            if w.fiber.token.cancelled:
                self._remove_waiter(w)
                continue
            if self._safe_cond(w.wf, w.fiber.run, w.cond) == w.want_true:
                self._remove_waiter(w)
                self.strand.cancel(w.timer)
                self._step(w.fiber, OK)

    def _remove_waiter(self, w: _Waiter) -> None:
        w.active = False
        if w in self._waiters:
            self._waiters.remove(w)

    def _deliver_mqtt(self, topic: str, payload: str, only_filter: Optional[str] = None) -> None:
        for t in self._triggers():
            if t.kind != "mqtt":
                continue
            match = t.topic.topic == only_filter if only_filter is not None else topic_matches(t.topic.topic, topic)
            if not match:
                continue
            value: Any = payload
            if t.json_payload:
                try:
                    value = _js_parse(payload)
                except ValueError:
                    self._trace("error", None, t.wf.id, t.id, t.block_id, {"reason": "payload_not_json", "topic": topic})
                    continue
            self._fire(t, {"payload": value, "topic": topic})

    # ---- concurrency
    def _runs_for(self, t: _TriggerDef) -> List[_Run]:
        return self._runs_of.setdefault(t.wf.id, {}).setdefault(t, [])

    def _active(self, t: _TriggerDef) -> List[_Run]:
        return [r for r in self._runs_for(t) if not r.finished]

    def _fire(self, t: _TriggerDef, outputs: Dict[str, Any]) -> None:
        if self.stopped:
            return
        act = self._active(t)

        def start() -> None:
            self._start_run(t, outputs)

        if t.kind == "app_start" or not act:
            start()
        elif t.policy == "restart":
            for r in act:
                self._cancel_run(r, "restart")
            start()
        elif t.policy == "ignore":
            return
        elif t.policy == "queue":
            q = self._queues.setdefault(t, [])
            if len(q) >= t.queue_max:
                q.pop(0)
                self._trace("error", None, t.wf.id, t.id, t.block_id, {"reason": "queue_overflow"})
            q.append(start)
        elif len(act) < t.max_runs:  # parallel
            start()

    def _start_run(self, t: _TriggerDef, outputs: Dict[str, Any]) -> None:
        self.run_count += 1
        run = _Run(self.run_count, t, _Token.child(self._app_token))
        run.outputs[t.id] = outputs
        runs = self._runs_for(t)
        runs[:] = [r for r in runs if not r.finished]
        runs.append(run)
        out = {k: V.to_json(v, t.outputs.get(k, "")) for k, v in outputs.items()}
        self._trace("trigger", run, t.wf.id, t.id, t.block_id, {"outputs": out})
        self._spawn(run, run.token, t.entry)

    def _cancel_run(self, run: _Run, reason: str) -> None:
        if run.finished:
            return
        run.token.cancel()
        run.finished = True
        self._trace("cancel", run, run.trigger.wf.id, run.trigger.id, run.trigger.block_id, {"reason": reason})
        # Its waiting fibers end now: a long-running app must not keep one per restart.
        self._reap(run, self._current)

    def _finish_run(self, run: _Run) -> None:
        if run.finished:
            return
        run.finished = True
        q = self._queues.get(run.trigger)
        if q:
            q.pop(0)()

    # ---- fibers
    def _new_fiber(self, run: _Run, token: _Token) -> _Fiber:
        self._fiber_count += 1
        f = _Fiber(run, self._fiber_count, token)
        run.fibers[f] = None

        def on_done() -> None:
            run.fibers.pop(f, None)
            if not run.fibers:
                self._finish_run(run)

        f.on_done = on_done
        return f

    def _spawn(self, run: _Run, token: _Token, entry: str) -> None:
        f = self._new_fiber(run, token)
        f.k = lambda _r: self._chain(f, entry, lambda: self._complete(f))
        self._step(f, None)

    def _spawn_later(self, run: _Run, entry: str) -> _Fiber:
        """Parallel branch: a child fiber started at the same instant, after the parent's current step."""
        f = self._new_fiber(run, _Token.child(run.token))
        f.k = lambda _r: self._chain(f, entry, lambda: self._complete(f))
        self._schedule(self._now(), lambda: self._step(f, None))
        return f

    def _step(self, f: _Fiber, resume: Optional[str]) -> None:
        if f.done:
            f.k = None
            return
        if f.token.cancelled:
            self._complete(f)
            return
        k = f.k
        f.k = None
        if k is None:
            return
        outer = self._current
        self._current = f
        try:
            k(resume)
        except _StopRun:
            self._current = outer
            self._complete(f)
            return
        self._current = outer

    def _reap(self, run: _Run, except_: Optional[_Fiber]) -> None:
        """Cancelled fibers end when they are cancelled, so the run ends as soon as its last live fiber does."""
        live = sorted((f for f in run.fibers if f is not except_ and f.token.cancelled and not f.done), key=lambda f: f.order)
        for f in live:
            self._complete(f)

    def _complete(self, f: _Fiber) -> None:
        if f.done:
            return
        f.done = True
        f.k = None
        for w in list(f.waiters):
            w()
        if f.on_done is not None:
            f.on_done()

    def _sleep(self, f: _Fiber, ms: int, k: Cont) -> None:
        f.k = k
        self._schedule(self._now() + ms, lambda: self._step(f, None))

    def _until(self, f: _Fiber, wf: Workflow, cond: Optional[Cond], timeout_ms: int, want_true: bool, k: Cont) -> None:
        f.k = k
        w = _Waiter(f, wf, cond, want_true)

        def on_timeout() -> None:
            if not w.active:
                return
            self._remove_waiter(w)
            self._step(w.fiber, TIMEOUT)

        w.timer = self._schedule(self._now() + timeout_ms, on_timeout)
        self._waiters.append(w)

    def _join(self, f: _Fiber, children: List[_Fiber], mode: str, k: Cont) -> None:
        f.k = k
        pending = [c for c in children if not c.done]
        if mode == "all" and not pending:
            self._schedule(self._now(), lambda: self._step(f, DONE))
            return
        if mode == "any" and len(pending) < len(children):
            for c in pending:
                c.token.cancel()
            self._reap(f.run, None)
            self._schedule(self._now(), lambda: self._step(f, DONE))
            return
        resumed = [False]

        def waiter() -> None:
            if resumed[0]:
                return
            left = [x for x in children if not x.done]
            if mode == "any" or not left:
                resumed[0] = True
                if mode == "any":
                    for x in left:
                        x.token.cancel()
                    self._reap(f.run, None)
                self._schedule(self._now(), lambda: self._step(f, DONE))

        for c in pending:
            c.waiters.append(waiter)

    # ---- evaluation
    def _safe_cond(self, wf: Workflow, run: Optional[_Run], cond: Optional[Cond]) -> bool:
        if cond is None:
            return False
        try:
            return cond(Ctx(self, wf, run)) is True
        except EvalError:
            return False

    # ---- interpreter
    def _chain(self, f: _Fiber, id: str, end: Callable[[], None]) -> None:
        """Runs the chain from ``id``; ``end`` runs when it returns (normally or because the run was cancelled)."""
        run = f.run
        if not id or run.token.cancelled:
            end()
            return
        node = run.trigger.wf._nodes[id]
        self._trace_node("enter", run, node)

        def k(handle: Optional[str]) -> None:
            r = f.run
            if r.token.cancelled:
                end()
                return
            if handle is not None:
                self._trace_node("exit", r, node, {"handle": handle})
            else:
                self._trace_node("exit", r, node)
            self._chain(f, node.next.get(handle, "") if handle is not None else "", end)

        self._exec(f, node, k)

    def _on_error(self, run: _Run, node: _NodeDef, reason: str, message: str) -> Optional[str]:
        """I/O error: ``error`` branch when connected, else ``onError`` (continue = log + next, stop = end run)."""
        out = run.outputs.setdefault(node.id, {})
        out["ok"] = False
        out["error"] = message
        self._trace_node("error", run, node, {"reason": reason, "message": message})
        if node.next.get("error"):
            return "error"
        if node.has_on_error and node.on_error == "stop":
            return None
        if "next" in node.next:
            return "next"
        return None

    def _exec(self, f: _Fiber, node: _NodeDef, k: Cont) -> None:
        run = f.run
        wf = run.trigger.wf
        c = Ctx(self, wf, run)
        kind = node.kind

        def fail(e: EvalError) -> None:
            k(self._on_error(run, node, e.reason, e.message))

        if kind == "write":
            s = node.signal
            try:
                v = node.value(c)
                rejected = self.vehicle.check_write(s.path, s.type, v)
                if rejected:
                    raise EvalError("no_value", rejected)
            except EvalError as e:
                fail(e)
                return
            if not node.flag:
                self.vehicle.set(s.path, s.type, v, None)
            self._trace_node("write", run, node, {"path": s.path, "value": V.to_json(v, s.type)})
            run.outputs[node.id] = {"ok": True, "error": ""}
            if not node.flag:
                k("next")
                return
            error = [""]

            def after_ack(_r: Optional[str]) -> None:
                if error[0]:
                    k(self._on_error(f.run, node, "write_failed", error[0]))
                    return
                k("next")

            def acked(err: str) -> None:
                error[0] = err
                self._step(f, None)

            f.k = after_ack
            self.vehicle.set(s.path, s.type, v, acked)
            return
        if kind == "read":
            s = node.signal

            def finish(v: Any) -> None:
                if v is None:
                    k(self._on_error(f.run, node, "no_value", f"{s.path} has no value yet"))
                    return
                f.run.outputs[node.id] = {"value": v, "timestamp": self._now()}
                k("next")

            if not node.flag:
                finish(self._values.get(s.path))
                return
            got: List[Any] = [None, ""]

            def after_get(_r: Optional[str]) -> None:
                if got[1]:
                    k(self._on_error(f.run, node, "read_failed", got[1]))
                    return
                finish(got[0])

            def answered(v: Optional[Any], err: str) -> None:
                got[0], got[1] = v, err
                self._step(f, None)

            f.k = after_get
            self.vehicle.get(s.path, s.type, answered)
            return
        if kind == "branch":
            try:
                b = node.condition is not None and node.condition(c) is True
            except EvalError as e:
                fail(e)
                return
            k("then" if b else "else")
            return
        if kind == "switch":
            handle = "default"
            try:
                v = node.value(c)
                for i, case in enumerate(node.cases):
                    if _switch_match(v, case(c)):
                        handle = f"case_{i}"
                        break
            except EvalError as e:
                fail(e)
                return
            k(handle)
            return
        if kind == "wait":
            self._sleep(f, node.ms, lambda _r: k("next"))
            return
        if kind == "wait_until":
            if self._safe_cond(wf, run, node.condition):
                k("ok")
                return
            self._until(f, wf, node.condition, node.ms, True, lambda r: k("ok" if r == OK else "timeout"))
            return
        if kind == "stable_for":
            if not self._safe_cond(wf, run, node.condition):
                k("broken")
                return
            self._until(f, wf, node.condition, node.ms, False, lambda r: k("broken" if r == OK else "stable"))
            return
        if kind == "repeat":
            self._repeat_step(f, node, 0, k)
            return
        if kind == "while":
            self._while_step(f, node, 0, k)
            return
        if kind == "parallel":
            children = [self._spawn_later(f.run, entry) for entry in node.branches]
            if node.join == "none":
                k("next")
                return
            self._join(f, children, node.join, lambda _r: k("next"))
            return
        if kind == "stop":
            if node.scope == "app":
                self.stopped = True
                self._app_token.cancel()
                self.strand.stop()
            elif node.scope == "workflow":
                for runs in list(self._runs_of.get(wf.id, {}).values()):
                    for r in list(runs):
                        if r is not run:
                            self._cancel_run(r, "stop")
            run.token.cancel()
            self._reap(run, self._current)
            raise _StopRun()
        if kind == "state_get":
            run.outputs[node.id] = {"value": wf._state.get(node.state.id)}
            k("next")
            return
        if kind == "state_set":
            try:
                v = node.value(c)
            except EvalError as e:
                fail(e)
                return
            wf._state[node.state.id] = v
            self._after_change()
            k("next")
            return
        if kind == "counter":
            type_ = node.state.type
            if node.counter_op == "reset":
                nxt = V.from_json(wf._state_initial[node.state.id], type_)
            else:
                cur_v = wf._state.get(node.state.id)
                cur = cur_v if _is_int(cur_v) else int(V.num(cur_v))
                nxt = V.cast(cur - node.count if node.counter_op == "dec" else cur + node.count, type_)
            wf._state[node.state.id] = nxt
            run.outputs[node.id] = {"value": nxt}
            self._after_change()
            k("next")
            return
        if kind == "eval":
            try:
                v = node.value(c)
            except EvalError as e:
                fail(e)
                return
            run.outputs[node.id] = {node.output or "result": v}
            k("next")
            return
        if kind == "in_range":
            try:
                x = V.num(node.value(c))
                lo = V.num(node.low(c))
                hi = V.num(node.high(c))
                if node.flag:
                    key = f"{wf.id}/{node.id}"
                    s = self._hysteresis.get(key, False)
                    if x >= hi:
                        s = True
                    elif x <= lo:
                        s = False
                    self._hysteresis[key] = s
                    result = s
                else:
                    result = lo <= x <= hi
            except EvalError as e:
                fail(e)
                return
            run.outputs[node.id] = {"result": result, "state": result}
            k("next")
            return
        if kind == "filter":
            try:
                x = float(V.num(node.value(c)))
            except EvalError as e:
                fail(e)
                return
            key = f"{wf.id}/{node.id}"
            f = self._filters.get(key)
            if f is None:
                f = self._filters[key] = _FilterState()
            if node.filter_mode == "exponential":
                y = x if f.count == 0 else f.y + node.alpha * (x - f.y)
                f.y = y
                f.count = min(f.count + 1, 4294967295)
            else:
                f.window.append(x)
                if len(f.window) > node.count:
                    f.window.pop(0)
                if node.filter_mode == "median":
                    s = sorted(f.window)
                    m = len(s) // 2
                    y = s[m] if len(s) % 2 == 1 else (s[m - 1] + s[m]) / 2
                else:
                    # summed oldest → newest like every runtime (`sum()` would compensate and differ)
                    total = 0.0
                    for v in f.window:
                        total += v
                    y = total / len(f.window)
                f.count = len(f.window)
            run.outputs[node.id] = {"value": y, "samples": f.count}
            k("next")
            return
        if kind == "log":
            try:
                message = _text(node.value(c))
            except EvalError as e:
                fail(e)
                return
            self.sink.log(self._now(), node.level if node.level is not None else "info", message)
            d: Dict[str, Any] = {"kind": "log"}
            if node.level is not None:
                d["level"] = node.level
            d["message"] = message
            self._trace_node("value", run, node, d)
            k("next")
            return
        if kind == "publish":
            try:
                payload = _text(node.value(c))
            except EvalError as e:
                fail(e)
                return
            self._trace_node("value", run, node, {"kind": "mqtt", "topic": node.topic.topic, "payload": payload})
            self.pubsub.publish(node.topic.topic, payload)
            k("next")
            return
        raise RuntimeError(f"simvehicleapp runtime: node {node.id} has an unknown kind")

    def _repeat_step(self, f: _Fiber, node: _NodeDef, i: int, k: Cont) -> None:
        if not (i < node.count and not f.run.token.cancelled):
            k("next")
            return

        def body(_r: Optional[str]) -> None:
            f.run.outputs[node.id] = {"index": i}
            self._chain(f, node.body, lambda: self._sleep(f, 0, lambda _x: self._repeat_step(f, node, i + 1, k)))

        if i > 0 and node.ms > 0:
            self._sleep(f, node.ms, body)
        else:
            body(None)

    def _while_step(self, f: _Fiber, node: _NodeDef, i: int, k: Cont) -> None:
        if f.run.token.cancelled:
            k("next")
            return

        def body(_r: Optional[str]) -> None:
            r = f.run
            try:
                go = node.condition is not None and node.condition(Ctx(self, r.trigger.wf, r)) is True
            except EvalError as e:
                k(self._on_error(r, node, e.reason, e.message))
                return
            if not go:
                k("next")
                return
            if i >= node.max_iterations:
                self._trace_node("error", r, node, {"reason": "loop_guard", "maxIterations": node.max_iterations})
                r.token.cancel()
                self._reap(r, self._current)
                raise _StopRun()
            r.outputs[node.id] = {"index": i}
            self._chain(f, node.body, lambda: self._sleep(f, 0, lambda _x: self._while_step(f, node, i + 1, k)))

        if i > 0 and node.ms > 0:
            self._sleep(f, node.ms, body)
        else:
            body(None)

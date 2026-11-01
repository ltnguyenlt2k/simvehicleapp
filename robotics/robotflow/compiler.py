"""rflowc — RobotFlow compiler: robotflow.v1 → diagnostics, IR (rfir.v1) and a deterministic Python app (ADR-0067).

Stages: shape → resolve (registry, catalog, profile) → props/expressions → structure → safety lint → IR → codegen.
Generated code is a small state machine: one async function per node returning the next node id; the runtime
(rfrt) provides command/move/wait/log primitives against Protobus. No eval, no timestamps, stable ordering.
"""
from __future__ import annotations

import hashlib
import json
import math
import pathlib
import re
from dataclasses import dataclass, field

from robotflow.expr import ExprError, compile_condition, template_paths

HERE = pathlib.Path(__file__).resolve().parent
VERSION = "0.1.0"
RUNTIME_VERSION = "0.1.0"
NODE_ID = re.compile(r"^[A-Za-z0-9_-]{1,96}$")
TRIGGERS = {"rf.on_start", "rf.on_condition", "rf.every"}
CONTROL = {"rf.arm", "rf.disarm", "rf.reset_stop", "rf.move", "rf.perform", "rf.go_to", "rf.follow_route"}
NEEDS_ARM = {"rf.move", "rf.perform", "rf.go_to", "rf.follow_route"}
BLOCKING = CONTROL | {"rf.stop", "rf.wait", "rf.wait_until"}


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def sha(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def load_registry() -> dict:
    return json.loads((HERE / "registry.json").read_text(encoding="utf-8"))


@dataclass
class Diagnostic:
    code: str
    severity: str
    message: str
    nodeId: str | None = None
    prop: str | None = None

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v is not None}


@dataclass
class Result:
    diagnostics: list = field(default_factory=list)
    ir: dict | None = None
    files: dict | None = None

    @property
    def ok(self) -> bool:
        return not any(d.severity == "error" for d in self.diagnostics)

    def as_dict(self) -> dict:
        return {"ok": self.ok, "diagnostics": [d.as_dict() for d in self.diagnostics], "ir": self.ir, "files": self.files}


class Compiler:
    def __init__(self, catalog: dict, registry: dict | None = None, mode: str = "mock"):
        self.catalog = catalog
        self.nodes_rss = catalog["nodes"]
        self.registry = registry or load_registry()
        self.blocks = {b["id"]: b for b in self.registry["blocks"]}
        self.mode = mode  # mock | ros-sim: pending profile interfaces are errors on ros-sim

    # ------------------------------------------------------------ entry points

    def lint(self, workflow: dict) -> Result:
        result = Result()
        self._check(workflow, result)
        return result

    def build(self, workflow: dict) -> Result:
        result = Result()
        ir = self._check(workflow, result)
        if result.ok and ir is not None:
            result.ir = ir
            result.files = self._codegen(workflow, ir)
        return result

    # ------------------------------------------------------------ checks

    def _err(self, result, code, message, node=None, prop=None, severity="error"):
        result.diagnostics.append(Diagnostic(code, severity, message, node, prop))

    def _check(self, wf: dict, result: Result) -> dict | None:
        if not isinstance(wf, dict) or wf.get("schema") != "robotflow.v1" or not isinstance(wf.get("nodes"), list) \
                or not isinstance(wf.get("edges"), list):
            self._err(result, "RF1001", "workflow must be robotflow.v1 with nodes and edges")
            return None
        if wf.get("profile") != self.catalog["profile"]:
            self._err(result, "RF1003", f"workflow profile {wf.get('profile')} differs from {self.catalog['profile']}")
        rss = wf.get("rss") or {}
        if rss.get("catalogHash") not in (None, self.catalog["catalogHash"]):
            self._err(result, "RF1003", "workflow was written for another RSS catalog; review and save it again")
        if len(wf["nodes"]) > 500 or len(wf["edges"]) > 2000:
            self._err(result, "RF1001", "workflow too large (≤ 500 blocks, ≤ 2000 links)")
            return None
        nodes: dict[str, dict] = {}
        for raw in wf["nodes"]:
            node_id = raw.get("id") if isinstance(raw, dict) else None
            if not isinstance(node_id, str) or not NODE_ID.match(node_id):
                self._err(result, "RF1001", "block id must be 1–96 letters, digits, '-' or '_'")
                continue
            if node_id in nodes:
                self._err(result, "RF1004", "duplicate block id", node_id)
                continue
            if raw.get("block") not in self.blocks:
                self._err(result, "RF1002", f"unknown block {raw.get('block')!r}", node_id)
                continue
            nodes[node_id] = raw
        if not nodes:
            self._err(result, "RF1008", "add a trigger block (e.g. 'Khi bắt đầu')")
            return None
        next_of: dict[str, dict[str, str | None]] = {n: {p: None for p in self.blocks[nodes[n]["block"]]["outputs"]} for n in nodes}
        incoming: dict[str, int] = {n: 0 for n in nodes}
        for edge in wf["edges"]:
            try:
                (src, port), (dst, _) = edge["from"], edge["to"]
            except (KeyError, TypeError, ValueError):
                self._err(result, "RF1005", "malformed link")
                continue
            if src not in nodes or dst not in nodes:
                self._err(result, "RF1005", "link to a missing block", src if src in nodes else None)
                continue
            if port not in next_of[src]:
                self._err(result, "RF1005", f"block has no output '{port}'", src)
                continue
            if next_of[src][port] is not None:
                self._err(result, "RF1006", f"output '{port}' is linked more than once", src)
                continue
            if nodes[dst]["block"] in TRIGGERS:
                self._err(result, "RF1009", "a trigger cannot have incoming links", dst)
                continue
            next_of[src][port] = dst
            incoming[dst] += 1
        compiled: dict[str, dict] = {}
        for node_id, raw in nodes.items():
            compiled[node_id] = self._props(node_id, raw, result)
        triggers = sorted(n for n in nodes if nodes[n]["block"] in TRIGGERS)
        if not triggers:
            self._err(result, "RF1008", "add a trigger block (e.g. 'Khi bắt đầu')")
        reachable: set[str] = set()
        for trigger in triggers:
            self._structure(trigger, nodes, next_of, reachable, result)
        for node_id in sorted(nodes):
            if node_id not in reachable:
                self._err(result, "RF1007", "block is not reachable from any trigger and will never run", node_id,
                          severity="warning")
            block = self.blocks[nodes[node_id]["block"]]
            if "failed" in block["outputs"] and next_of[node_id]["failed"] is None and node_id in reachable:
                self._err(result, "RF4002", "failure is not handled (the branch ends if this step fails)", node_id,
                          severity="info")
        if not result.ok:
            return None
        signals = sorted({p for c in compiled.values() for p in c.get("paths", [])})
        behaviors = []
        for trigger in triggers:
            block = nodes[trigger]["block"]
            behaviors.append({"trigger": trigger, "kind": block.split(".")[1], "entry": next_of[trigger]["next"],
                              **{k: v for k, v in compiled[trigger].items() if k in ("forMs", "repeat", "periodMs", "cond")}})
        return {"schema": "rfir.v1", "profile": self.catalog["profile"], "catalogHash": self.catalog["catalogHash"],
                "registryHash": sha(canonical(self.registry)), "compilerVersion": VERSION,
                "signals": signals, "behaviors": behaviors,
                "nodes": {n: {"block": nodes[n]["block"], "label": str(nodes[n].get("label", ""))[:96], **compiled[n],
                              "next": next_of[n]} for n in sorted(reachable)}}

    def _props(self, node_id: str, raw: dict, result: Result) -> dict:
        block = self.blocks[raw["block"]]
        props = raw.get("props") or {}
        out: dict = {}
        paths: set[str] = set()
        for spec in block["props"]:
            name = spec["name"]
            value = props.get(name, spec.get("default"))
            where = (node_id, name)
            if value is None or value == "":
                self._err(result, "RF3001", f"{spec['title']['en']} is required", *where)
                continue
            kind = spec["type"]
            try:
                if kind == "condition":
                    code, used = compile_condition(str(value), self.nodes_rss)
                    out["cond"], out["condText"] = code, str(value)
                    paths |= set(used)
                elif kind == "template":
                    text = str(value)[:500]
                    paths |= set(template_paths(text, self.nodes_rss))
                    out[name] = text
                elif kind in ("duration", "integer"):
                    number = float(value)
                    if not math.isfinite(number) or number != int(number) or not spec.get("min", 0) <= number <= spec.get("max", 1e12):
                        raise ExprError("RF3001", f"{spec['title']['en']} must be a whole number in [{spec.get('min', 0)}, {spec.get('max')}]")
                    out[name] = int(number)
                elif kind == "number":
                    number = float(value)
                    if not math.isfinite(number):
                        raise ExprError("RF3001", f"{spec['title']['en']} must be a number")
                    limit = self._signal_limit(spec)
                    if limit and not limit[0] <= number <= limit[1]:
                        raise ExprError("RF3003", f"{spec['title']['en']} must be within [{limit[0]}, {limit[1]}] for this robot")
                    out[name] = number
                elif kind == "boolean":
                    out[name] = value in (True, "true", "1", 1)
                elif kind == "enum":
                    values = spec.get("values") or self._enum_from(spec["valuesFrom"])
                    if value not in values:
                        raise ExprError("RF3002", f"{value!r} is not supported by this robot ({', '.join(values)})")
                    out[name] = value
                elif kind == "points":
                    out[name] = self._points(value)
            except (ExprError, ValueError, TypeError) as error:
                code = error.code if isinstance(error, ExprError) else "RF3001"
                message = error.message if isinstance(error, ExprError) else f"{spec['title']['en']} is invalid"
                self._err(result, code, message, *where)
        command = block.get("command") or block.get("setpoint")
        if command:
            node = self.nodes_rss.get(command)
            if node is None:
                self._err(result, "RF1010", f"{command} is not available on this robot", node_id)
            elif node.get("pending"):
                pending = node["pending"]
                ok_now = raw["block"] == "rf.perform" and out.get("name") in ("CROUCH", "BOW", "TILT", "LIFT_FRONT_LEFT", "JUMP")
                if not ok_now:
                    severity = "error" if self.mode == "ros-sim" else "warning"
                    self._err(result, "RF1010", f"not yet available on the ROS robot: {pending}", node_id, severity=severity)
        out["paths"] = sorted(paths)
        return out

    def _enum_from(self, ref: str) -> list:
        path, _, arg = ref.rpartition(".")
        return self.nodes_rss[path]["args"][arg]["values"]

    def _signal_limit(self, spec: dict):
        ref = spec.get("signal")
        if not ref:
            return None
        path, _, name = ref.rpartition(".")
        field_spec = self.nodes_rss.get(path, {}).get("fields", {}).get(name, {})
        return (field_spec.get("min", -math.inf), field_spec.get("max", math.inf))

    def _points(self, value) -> list:
        if isinstance(value, str):
            points = [[float(x) for x in part.split(",")] for part in value.split(";") if part.strip()]
        else:
            points = [[float(p["X"]), float(p["Y"])] for p in value]
        limit = self.nodes_rss["Robot.Navigation.FollowRoute"]["args"]["Waypoints"]["maxItems"]
        if not 1 <= len(points) <= limit or any(len(p) != 2 or not all(map(math.isfinite, p)) for p in points):
            raise ExprError("RF3004", f"enter 1–{limit} points as 'X,Y; X,Y'")
        return points

    def _structure(self, trigger, nodes, next_of, reachable, result) -> None:
        """Reachability, busy loops and 'motion before Arm' along every path from a trigger."""
        stack = [(trigger, False, frozenset())]
        seen: set[tuple] = set()
        while stack:
            node_id, armed, since_block = stack.pop()
            block = nodes[node_id]["block"]
            is_blocking = block in BLOCKING or block in TRIGGERS
            if node_id in since_block and not is_blocking:
                self._err(result, "RF4003", "this loop has no wait or robot step and would spin forever", node_id)
                continue
            key = (node_id, armed, since_block)
            if key in seen or len(seen) > 20000:
                continue
            seen.add(key)
            reachable.add(node_id)
            if block in NEEDS_ARM and not armed:
                self._err(result, "RF4001", "the robot may not be armed here: add 'Arm' before motion blocks",
                          node_id, severity="warning")
            path_since = frozenset() if is_blocking else since_block | {node_id}
            for port, target in sorted(next_of[node_id].items()):
                if target is None:
                    continue
                now_armed = (armed or (block == "rf.arm" and port == "ok")) and not (block in ("rf.disarm", "rf.stop") and port == "ok")
                stack.append((target, now_armed, path_since))

    # ------------------------------------------------------------ codegen

    def _codegen(self, wf: dict, ir: dict) -> dict:
        lines = [
            "# Generated by rflowc %s. Do not edit: rebuild from the workflow instead." % VERSION,
            "# profile=%s catalog=%s" % (ir["profile"], ir["catalogHash"]),
            "from rfrt import Behavior, Flow",
            "",
            "",
        ]
        funcs = []
        for node_id, node in ir["nodes"].items():
            fn = _ident(node_id)
            label = (node.get("label") or node["block"]).replace("\n", " ")
            body = self._node_body(node_id, node)
            funcs.append(f"async def n_{fn}(rt):  # {node['block']} {label!r}\n" + "\n".join("    " + b for b in body))
            if "cond" in node:
                funcs.append(f"def c_{fn}(v):  # {node.get('condText', '')!r}\n    return {node['cond']}")
        lines.append("\n\n\n".join(funcs))
        lines.append("")
        lines.append("")
        lines.append("NODES = {" + ", ".join(f"{n!r}: n_{_ident(n)}" for n in ir["nodes"]) + "}")
        behaviors = []
        for b in ir["behaviors"]:
            cond = f"c_{_ident(b['trigger'])}" if "cond" in b else "None"
            behaviors.append(f"    Behavior({b['trigger']!r}, {b['kind']!r}, {b['entry']!r}, cond={cond}, "
                             f"for_ms={b.get('forMs', 0)!r}, repeat={b.get('repeat', False)!r}, period_ms={b.get('periodMs', 0)!r}),")
        lines.append("FLOW = Flow(\n    signals=%r,\n    nodes=NODES,\n    behaviors=[\n%s\n    ],\n)" % (ir["signals"], "\n".join(behaviors)))
        flow = "\n".join(lines) + "\n"
        main = ("# Generated by rflowc. Entry point of the workflow app.\n"
                "from rfrt import main\n\nfrom app.flow import FLOW\n\nif __name__ == '__main__':\n    main(FLOW)\n")
        source = {k: wf[k] for k in ("schema", "rss", "profile", "nodes", "edges") if k in wf}
        files = {
            "app/__init__.py": "",
            "app/flow.py": flow,
            "app/main.py": main,
            "rfir.json": json.dumps(ir, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
            "workflow.json": json.dumps(source, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
        }
        lock = {"schema": "rflow-lock.v1", "compilerVersion": VERSION, "runtimeVersion": RUNTIME_VERSION,
                "profile": ir["profile"], "catalogHash": ir["catalogHash"], "registryHash": ir["registryHash"],
                "workflowHash": sha(canonical(source)), "irHash": sha(canonical(ir)),
                "files": {name: sha(text.encode()) for name, text in sorted(files.items())}}
        lock["artifactHash"] = sha(canonical(lock))
        files["rflow.lock.json"] = json.dumps(lock, indent=1, sort_keys=True) + "\n"
        return files

    def _node_body(self, node_id: str, node: dict) -> list[str]:
        block, nxt, n = node["block"], node["next"], repr(node_id)
        fn = _ident(node_id)

        def go(port):
            return repr(nxt.get(port))

        if block in TRIGGERS:
            return [f"return {go('next')}"]
        if block == "rf.if":
            return [f"ok = await rt.check({n}, c_{fn})", f"if ok is None:", "    return None",
                    f"return {go('then')} if ok else {go('else')}"]
        if block == "rf.wait":
            return [f"await rt.wait({n}, {node['ms']})", f"return {go('next')}"]
        if block == "rf.wait_until":
            return [f"done = await rt.wait_until({n}, c_{fn}, {node['timeoutMs']})",
                    f"return {go('next')} if done else {go('timeout')}"]
        if block == "rf.repeat":
            return [f"again = rt.repeat({n}, {node['count']})", f"return {go('body')} if again else {go('done')}"]
        if block == "rf.log":
            return [f"rt.log({n}, {node['level']!r}, {node['message']!r})", f"return {go('next')}"]
        if block == "rf.end":
            return ["return None"]
        if block == "rf.move":
            call = f"await rt.move({n}, {node['linear']!r}, {node['angular']!r}, {node['durationMs']})"
        elif block == "rf.stop":
            call = f"await rt.stop({n})"
        else:
            command = self.blocks[block]["command"]
            args = {"rf.perform": lambda: {"Name": node["name"]},
                    "rf.go_to": lambda: {"X": node["x"], "Y": node["y"]},
                    "rf.follow_route": lambda: {"Waypoints": [{"X": x, "Y": y} for x, y in node["waypoints"]]}}.get(block, dict)()
            call = f"await rt.command({n}, {command!r}, {args!r})"
        return [f"ok = {call}", f"return {go('ok')} if ok else {go('failed')}"]


def _ident(node_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "_", node_id) + "_" + hashlib.sha1(node_id.encode()).hexdigest()[:6]

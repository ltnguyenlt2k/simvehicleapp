"""rflowc: diagnostics, determinism, generated code shape."""
import copy
import json
import pathlib

import pytest

from robotflow.compiler import Compiler
from rss import rssc

EXAMPLE = json.loads((pathlib.Path(__file__).parents[1] / "examples" / "greet-and-patrol.json").read_text())


@pytest.fixture(scope="module")
def catalog():
    return rssc.build("dog-go2-sim")


def codes(result):
    return {(d.code, d.nodeId) for d in result.diagnostics}


def test_example_builds_deterministically(catalog):
    first, second = Compiler(catalog).build(EXAMPLE), Compiler(catalog).build(copy.deepcopy(EXAMPLE))
    assert first.ok, [d.as_dict() for d in first.diagnostics]
    assert first.files == second.files
    lock = json.loads(first.files["rflow.lock.json"])
    assert lock["artifactHash"].startswith("sha256:") and set(lock["files"]) == set(first.files) - {"rflow.lock.json"}
    flow = first.files["app/flow.py"]
    compile(flow, "flow.py", "exec")
    assert "Robot.Motion.Perform" in flow and "eval(" not in flow and "import os" not in flow
    assert first.ir["signals"] == sorted(first.ir["signals"]) and "Robot.Perception.Marker.IsDetected" in first.ir["signals"]


def test_motion_names_pending_on_ros_are_errors_only_for_ros(catalog):
    wf = copy.deepcopy(EXAMPLE)
    next(n for n in wf["nodes"] if n["id"] == "paw")["props"]["name"] = "WAVE_FRONT_LEFT"
    assert ("RF1010", "paw") in codes(Compiler(catalog, mode="mock").lint(wf))
    assert Compiler(catalog, mode="mock").lint(wf).ok
    assert not Compiler(catalog, mode="ros-sim").lint(wf).ok


@pytest.mark.parametrize("node,props,code", [
    ("battery", {"when": "Robot.PowerSystem.Battery.StateOfCharge >= 20 m"}, "RF2004"),
    ("battery", {"when": "Robot.Safety.Mode == \"MANUEL\""}, "RF2005"),
    ("battery", {"when": "Robot.Nope.Signal > 1"}, "RF2002"),
    ("battery", {"when": "Robot.PowerSystem.Battery.StateOfCharge"}, "RF2006"),
    ("bow", {"name": "MOONWALK"}, "RF3002"),
    ("out", {"x": "abc", "y": 0}, "RF3001"),
    ("patrol", {"count": 0}, "RF3001"),
])
def test_property_diagnostics_point_to_the_block(catalog, node, props, code):
    wf = copy.deepcopy(EXAMPLE)
    next(n for n in wf["nodes"] if n["id"] == node)["props"].update(props)
    result = Compiler(catalog).lint(wf)
    assert not result.ok and (code, node) in codes(result)


def test_move_speed_is_limited_by_the_robot_profile(catalog):
    wf = {"schema": "robotflow.v1", "profile": "dog-go2-sim", "nodes": [
        {"id": "s", "block": "rf.on_start"}, {"id": "a", "block": "rf.arm"},
        {"id": "m", "block": "rf.move", "props": {"linear": 0.9, "angular": 0, "durationMs": 500}}],
        "edges": [{"from": ["s", "next"], "to": ["a", "in"]}, {"from": ["a", "ok"], "to": ["m", "in"]}]}
    assert ("RF3003", "m") in codes(Compiler(catalog).lint(wf))


def test_structure_rules(catalog):
    wf = {"schema": "robotflow.v1", "profile": "dog-go2-sim", "nodes": [
        {"id": "s", "block": "rf.on_start"}, {"id": "l1", "block": "rf.log"}, {"id": "l2", "block": "rf.log"},
        {"id": "p", "block": "rf.perform"}, {"id": "orphan", "block": "rf.wait"}],
        "edges": [{"from": ["s", "next"], "to": ["l1", "in"]}, {"from": ["l1", "next"], "to": ["l2", "in"]},
                  {"from": ["l2", "next"], "to": ["l1", "in"]}, {"from": ["p", "ok"], "to": ["s", "in"]}]}
    found = codes(Compiler(catalog).lint(wf))
    assert ("RF4003", "l1") in found or ("RF4003", "l2") in found  # busy loop
    assert ("RF1009", "s") in found and ("RF1007", "orphan") in found
    wf2 = copy.deepcopy(EXAMPLE)
    wf2["edges"] = [x for x in wf2["edges"] if x["from"] != ["hello", "next"]] + [{"from": ["hello", "next"], "to": ["bow", "in"]}]
    assert ("RF4001", "bow") in codes(Compiler(catalog).lint(wf2))  # motion without Arm on that path
    wf3 = copy.deepcopy(EXAMPLE)
    wf3["edges"].append({"from": ["arm", "ok"], "to": ["low", "in"]})
    assert ("RF1006", "arm") in codes(Compiler(catalog).lint(wf3))


def test_no_trigger_and_bad_shape(catalog):
    assert ("RF1001", None) in codes(Compiler(catalog).lint({"schema": "x"}))
    only = {"schema": "robotflow.v1", "profile": "dog-go2-sim", "nodes": [{"id": "l", "block": "rf.log"}], "edges": []}
    assert ("RF1008", None) in codes(Compiler(catalog).lint(only))


def test_every_rf_code_is_in_the_public_catalog():
    import re
    source = (pathlib.Path(__file__).parents[1] / "compiler.py").read_text() + (pathlib.Path(__file__).parents[1] / "expr.py").read_text()
    used = set(re.findall(r'"(RF\d{4})"', source))
    catalog = json.loads((pathlib.Path(__file__).parents[2] / "contracts" / "diagnostics.v1.json").read_text())
    assert used and used <= set(catalog["codes"]), sorted(used - set(catalog["codes"]))

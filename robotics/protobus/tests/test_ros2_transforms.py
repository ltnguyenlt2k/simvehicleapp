"""ROS→RSS transforms and request templates (pure; the bridge itself runs on ROS 2 Humble)."""
import math
from types import SimpleNamespace as N

import pytest

from protobus.ros2 import transforms as t


def quat(yaw):
    return N(x=0.0, y=0.0, z=math.sin(yaw / 2), w=math.cos(yaw / 2))


def test_field_scale_and_nan():
    msg = N(percentage=0.92, voltage=float("nan"), present=True)
    assert t.field(msg, "percentage", scale=100.0) == pytest.approx(92.0)
    assert t.field(msg, "voltage") is None
    assert t.field(msg, "present") is True


def test_quaternion_axes():
    msg = N(pose=N(pose=N(orientation=quat(0.7))))
    assert t.quat(msg, "pose.pose.orientation", "yaw") == pytest.approx(0.7)
    assert t.quat(msg, "pose.pose.orientation", "roll") == pytest.approx(0.0)
    assert t.quat(N(pose=N(pose=N(orientation=N(x=0, y=0, z=0, w=0)))), "pose.pose.orientation", "yaw") is None


def test_feet_order_is_checked():
    msg = N(feet=["FL", "FR", "RL", "RR"], contact=[True, False, True, True], normal_force_n=[10.0, 0.0, 9.0, 8.0])
    assert t.array_index(msg, "contact", 1, expect_name="FR") is False
    assert t.array_index(msg, "normal_force_n", 0, expect_name="FL") == 10.0
    assert t.array_index(msg, "contact", 1, expect_name="RL") is None  # name mismatch ⇒ no value


def test_joint_by_name():
    msg = N(name=["FL_hip_joint", "FL_calf_joint"], position=[0.1, -1.5], velocity=[0.0, 0.2], effort=[])
    assert t.joint(msg, "FL_calf_joint", "position") == -1.5
    assert t.joint(msg, "FL_calf_joint", "effort") is None
    assert t.joint(msg, "RR_hip_joint", "position") is None


def test_json_transforms():
    state = {"mode": "MOTION", "motion": {"phase": "RUNNING", "name": "lift_fl"}, "active_motion_id": "x", "controller": None}
    names = {"lift_fl": "LIFT_FRONT_LEFT"}
    assert t.json_field(state, "motion.name", map=names) == "LIFT_FRONT_LEFT"
    assert t.json_field(state, "controller", default="NONE") == "NONE"
    assert t.json_in(state, "mode", ["MANUAL", "AUTO", "MOTION"]) is True
    assert t.json_not_null(state, "active_motion_id") is True


def test_detections_and_scan():
    hit = N(results=[N(hypothesis=N(class_id="red_sim_marker"))])
    other = N(results=[N(hypothesis=N(class_id="cone"))])
    msg = N(detections=[hit, other, hit])
    assert t.count_class(msg, "red_sim_marker") == 2
    assert t.count_class(N(detections=[]), "red_sim_marker", as_bool=True) is False
    scan = N(ranges=[float("inf"), 0.01, 2.5, 1.25], range_min=0.05, range_max=12.0)
    assert t.min_finite(scan, "ranges") == 1.25


def test_request_templates():
    assert t.substitute({"action": "motion", "motion_name": "$Name"}, {"Name": "LIFT_FRONT_LEFT"},
                        {"Name": {"LIFT_FRONT_LEFT": "lift_fl"}}) == {"action": "motion", "motion_name": "lift_fl"}
    assert t.substitute({"goal": ["$X", "$Y"]}, {"X": 1.5, "Y": 0.0}) == {"goal": [1.5, 0.0]}
    route = t.substitute({"waypoints": "$Waypoints[X,Y]"}, {"Waypoints": [{"X": 1, "Y": 2}, {"X": 3, "Y": 4}]})
    assert route == {"waypoints": [[1.0, 2.0], [3.0, 4.0]]}
    with pytest.raises(KeyError):
        t.substitute({"motion_name": "$Name"}, {"Name": "MOONWALK"}, {"Name": {"JUMP": "jump"}})


def test_mapping_covers_profile_and_uses_known_transforms():
    import json
    import pathlib
    from rss import rssc
    mapping = json.loads((pathlib.Path(t.__file__).parent / "profiles" / "dog-go2-sim" / "mapping.json").read_text())
    catalog = rssc.build("dog-go2-sim")
    sensors = {p for p, n in catalog["nodes"].items() if n["kind"] == "sensor"}
    mapped = {s["path"] for s in mapping["sensors"]}
    assert mapped == sensors
    assert all(s["fn"] in t.TRANSFORMS or s["fn"] in t.DERIVED for s in mapping["sensors"])
    assert all(s["topic"] in mapping["topics"] for s in mapping["sensors"])
    commands = {p for p, n in catalog["nodes"].items() if n["kind"] == "command" and not n.get("safetyLane")}
    assert set(mapping["commands"]) == commands - {"Robot.Simulation.Battery.SetLevel"}  # W3 pending
    outgoing = json.dumps([mapping["commands"], mapping["setpoints"], mapping["stop"]])
    assert mapping["envelope"]["requestTopic"] == "workflow/request"  # the only topic the bridge publishes to
    assert "cmd_vel" not in outgoing and "motion/request" not in outgoing and "control/request" not in outgoing

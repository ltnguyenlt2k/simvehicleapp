"""Cross-check the dog-go2-sim profile against the dog-ros2-simulation repository at the pinned commit (M22-T05).

Standard library only, runs on the host (needs git and a local clone of the dog repository):

    python3 robotics/rss/check_dog_profile.py --catalog robotics/runtime/rss/a.json --dog ../04.dog-ros2-simulation

Reads files with `git show <commit>:<path>` so uncommitted work in the dog clone never affects the result.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
SOURCES = HERE / "spec" / "profiles" / "dog-go2-sim.sources.json"
MOTION_NAMES = {"CROUCH": "crouch", "BOW": "bow", "TILT": "tilt", "LIFT_FRONT_LEFT": "lift_fl", "JUMP": "jump",
                "WAVE_FRONT_LEFT": "wave_fl", "SIT": "sit", "STAND": "stand"}


def git_show(repo: pathlib.Path, commit: str, path: str) -> str:
    return subprocess.run(["git", "-C", str(repo), "show", f"{commit}:{path}"], check=True,
                          capture_output=True, text=True).stdout


def match(path: str, sources: dict) -> list[str]:
    hits = []
    for pattern in sources:
        if pattern.endswith(".*") and (path == pattern[:-2] or path.startswith(pattern[:-2] + ".")):
            hits.append(pattern)
        elif fnmatch.fnmatchcase(path, pattern):
            hits.append(pattern)
    return hits


def check(catalog: dict, dog: pathlib.Path) -> dict:
    sources_doc = json.loads(SOURCES.read_text())
    commit = sources_doc["sourceCommit"]
    sources = sources_doc["sources"]
    problems: list[str] = []
    if catalog["robot"].get("sourceCommit") != commit:
        problems.append("profile sourceCommit differs from sources.json")
    topics = {t["name"]: t["type"] for t in json.loads(git_show(dog, commit, "contracts/ros2/topics.json"))["topics"]}
    brain = git_show(dog, commit, "ros2_ws/src/dog_autonomy/dog_autonomy/brain.py")
    capabilities = git_show(dog, commit, "ros2_ws/src/dog_interfaces/dog_core/capabilities.py")
    ns = sources_doc["rosNamespace"]

    leaves = {p: n for p, n in catalog["nodes"].items() if n["kind"] != "branch"}
    checked_topics: dict[str, str] = {}
    for path, node in leaves.items():
        hits = match(path, sources)
        if not hits:
            problems.append(f"{path}: no ROS source declared")
            continue
        source = sources[sorted(hits, key=len)[-1]]
        topic = source.get("topic")
        if not topic:
            continue
        full = f"{ns}/{topic}"
        if full not in topics:
            if "pending" not in node:
                problems.append(f"{path}: topic {full} missing in dog contract and node not marked pending")
            continue
        if topics[full] != source["type"]:
            problems.append(f"{path}: {full} is {topics[full]}, sources say {source['type']}")
        checked_topics[full] = topics[full]
        field = source.get("field", "")
        if topic == "brain/state" and "pending" not in node and not field.startswith("action="):
            if f'"{field}"' not in brain:
                problems.append(f"{path}: brain/state field {field!r} not published by brain.py")

    velocity = catalog["nodes"]["Robot.Motion.Velocity"]["fields"]
    clamps = re.search(r"max\(-([\d.]+), min\(([\d.]+), v\)\), max\(-([\d.]+), min\(([\d.]+), w\)\)", brain)
    if not clamps:
        problems.append("brain.py manual clamp not found")
    else:
        lin, ang = float(clamps.group(2)), float(clamps.group(4))
        if velocity["LinearX"]["max"] > lin or -velocity["LinearX"]["min"] > float(clamps.group(1)):
            problems.append(f"LinearX range wider than brain clamp {lin}")
        if velocity["AngularZ"]["max"] > ang or -velocity["AngularZ"]["min"] > float(clamps.group(3)):
            problems.append(f"AngularZ range wider than brain clamp {ang}")
    route = re.search(r"1 <= len\(goals\) <= (\d+)", brain)
    max_items = catalog["nodes"]["Robot.Navigation.FollowRoute"]["args"]["Waypoints"]["maxItems"]
    if not route or max_items > int(route.group(1)):
        problems.append("FollowRoute maxItems exceeds brain route limit")
    msg_dir = HERE.parent / "protobus" / "ros2" / "interfaces" / "dog_interfaces"
    provenance = json.loads((msg_dir / "PROVENANCE.json").read_text())
    pinned = git_show(dog, provenance["commit"], "ros2_ws/src/dog_interfaces/msg/FootContacts.msg")
    local = (msg_dir / "msg" / "FootContacts.msg").read_text()
    import hashlib
    if pinned != local or hashlib.sha256(local.encode()).hexdigest() != provenance["sha256"]["msg/FootContacts.msg"]:
        problems.append("FootContacts.msg differs from the dog repository or its recorded sha256")
    current = git_show(dog, commit, "ros2_ws/src/dog_interfaces/msg/FootContacts.msg")
    if current != local:
        problems.append("FootContacts.msg changed in the dog repository since the pinned contract")
    named = re.search(r"NAMED_MOTIONS = \(([^)]*)\)", capabilities)
    existing = set(re.findall(r'"([a-z_]+)"', named.group(1))) if named else set()
    perform = catalog["nodes"]["Robot.Motion.Perform"]
    missing = [name for name in perform["args"]["Name"]["values"] if MOTION_NAMES[name] not in existing]
    if missing and "W2" not in perform.get("pending", ""):
        problems.append(f"motions {missing} absent in dog and not marked pending W2")
    return {"passed": not problems, "dogCommit": commit, "catalogHash": catalog["catalogHash"],
            "leaves": len(leaves), "rosTopicsChecked": dict(sorted(checked_topics.items())),
            "brainClamp": clamps.groups() if clamps else None, "routeLimit": route.group(1) if route else None,
            "dogNamedMotions": sorted(existing), "motionsPendingW2": missing, "problems": problems}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--dog", required=True)
    args = parser.parse_args()
    report = check(json.loads(pathlib.Path(args.catalog).read_text()), pathlib.Path(args.dog))
    print(json.dumps(report, indent=1))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())

"""Manifest of a recorded robot flow (ADR-0071): video hash and format, both repositories' commits, image ids,
chapters, checks, and every robot command cross-checked against the Protobus audit (dispatch + robot result).

usage: python3 robotics/scripts/video/manifest.py <run-dir> <published-video-name>
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

run = Path(sys.argv[1])
name = sys.argv[2]
sh = lambda cmd: subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()  # noqa: E731
result = json.loads((run / "run-result.json").read_text())
video = run / "robot-flow.mp4"
probe = json.loads(sh(f"docker run --rm -v {video.parent.resolve()}:/d --entrypoint ffprobe robotics/recorder:local "
                      f"-v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate,nb_frames "
                      f"-of json /d/{video.name}"))
stream = probe["streams"][0]
ids = {c["requestId"] for c in result["run"]["commands"]}
audit = [json.loads(line) for line in sh("docker exec sr-protobus-broker-ros-1 cat /audit/audit.jsonl").splitlines()
         if any(i in line for i in ids)]
for c in result["run"]["commands"]:
    kinds = {a["kind"] for a in audit if a.get("request_id") == c["requestId"]}
    if kinds != {"command.dispatch", "command.result"}:
        sys.exit(f"audit does not confirm {c['requestId']}: {kinds}")
containers = ["simvehicleapp-studio-1", "sr-robotics-control-1", "sr-protobus-broker-ros-1", "sr-protobus-ros2-1"]
containers += sh("docker ps --format '{{.Names}}' | grep ^dog-ros2").split()
images = {c: {"image": sh(f"docker inspect -f '{{{{.Config.Image}}}}' {c}"), "id": sh(f"docker inspect -f '{{{{.Image}}}}' {c}")}
          for c in containers}
images["recorder"] = {"image": "robotics/recorder:local", "id": sh("docker image inspect -f '{{.Id}}' robotics/recorder:local")}
repo = Path(__file__).resolve().parents[3]
manifest = {
    "schema": "sr-video-manifest.v1",
    "video": {
        "file": name,
        "sha256": hashlib.sha256(video.read_bytes()).hexdigest(),
        "durationS": round(float(probe["format"]["duration"]), 1),
        "codec": stream["codec_name"], "size": f"{stream['width']}x{stream['height']}", "frames": int(stream["nb_frames"]),
        "capture": "ffmpeg x11grab, one continuous take of the Xvfb screen (headed Chromium), no edits",
    },
    "language": result["lang"], "mode": result["mode"],
    "repos": {
        "simvehicleapp": {"head": sh(f"git -C {repo} rev-parse HEAD"), "dirty": bool(sh(f"git -C {repo} status --porcelain"))},
        "dog-ros2-simulation": {"head": sh(f"git -C {repo.parent / '04.dog-ros2-simulation'} rev-parse HEAD"),
                                "dirty": bool(sh(f"git -C {repo.parent / '04.dog-ros2-simulation'} status --porcelain"))},
    },
    "images": images, "chapters": result["chapters"], "checks": result["checks"],
    "artifactHash": result["artifactHash"], "deployment": result["deployment"], "run": result["run"],
    "robotSideEvidence": {"source": "protobus-broker-ros audit.jsonl: dispatch to the ROS 2 bridge and the result the robot reported",
                          "entries": audit},
    "reproduce": f"LANG_UI={result['lang']} MODE={result['mode']} robotics/scripts/video/run.sh <out-dir> 1",
}
(run / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
print(name, manifest["video"]["durationS"], "s,", len(audit), "audit entries, checks", len(result["checks"]))

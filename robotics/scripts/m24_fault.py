"""M24-T07 fault check (host side): kill a robotics process while the dog is driven by a workflow setpoint
stream, then measure from the robot's own state (gateway) how fast the body command returns to zero."""
import json
import subprocess
import sys
import time
import urllib.request

TARGET = sys.argv[1] if len(sys.argv) > 1 else "sr-protobus-ros2-1"


def brain():
    return json.load(urllib.request.urlopen("http://127.0.0.1:8090/api/state", timeout=2))["brain"]


probe = subprocess.Popen(["docker", "start", "-a", "m24-stream"], stdout=subprocess.PIPE, text=True)
for line in probe.stdout:
    if '"streaming"' in line:
        break
end = time.monotonic() + 15
while time.monotonic() < end and brain()["safe_command"][0] <= 0.05:
    time.sleep(0.02)
moving = brain()["safe_command"]
if moving[0] <= 0.05:
    print(json.dumps({"valid": False, "reason": "robot was not moving before the kill", "probe": probe.communicate(timeout=30)[0][-400:]}))
    sys.exit(1)
time.sleep(1.0)
killed_at = time.monotonic()
subprocess.run(["docker", "kill", TARGET], check=True, capture_output=True)
stopped_after = None
while time.monotonic() - killed_at < 5:
    state = brain()
    if state["safe_command"] == [0.0, 0.0]:
        stopped_after = time.monotonic() - killed_at
        break
    time.sleep(0.01)
final = brain()
rest = probe.communicate(timeout=30)[0]
print(json.dumps({"valid": True, "killed": TARGET, "commandBeforeKill": moving, "bodyCommandZeroAfterS": stopped_after,
                  "modeAfter": final["mode"], "reasonAfter": final["reason"], "controllerAfter": final["controller"],
                  "controllerReason": final.get("controller_reason"), "probe": rest.strip()[-400:]}, indent=1))

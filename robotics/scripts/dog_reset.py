"""Test/recording fixture through the dog's own operator API (Robot Zoo gateway): healthy, DISARMED robot at spawn."""
import json
import sys
import time
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8090"


def call(path, body=None):
    request = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json"}, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def brain():
    return call("/api/state")["brain"]


call("/api/control", {"action": "disarm"})
time.sleep(1)
print("reset world:", call("/api/sim", {"action": "reset"}).get("reason"))
# The reset is asynchronous: first see the stack leave readiness (old epoch), then wait for the new epoch.
end = time.time() + 20
while time.time() < end and brain().get("ready") and brain().get("nav_ready"):
    time.sleep(0.5)
end = time.time() + 300  # render, SLAM and Nav2 epochs take 2–3 min after a world reset
while time.time() < end and not (brain().get("ready") and brain().get("nav_ready")):
    time.sleep(1)
call("/api/control", {"action": "reset_stop"})
time.sleep(2)
state = brain()
print(json.dumps({"mode": state["mode"], "ready": state["ready"], "navReady": state["nav_ready"], "controller": state.get("controller"),
                  "scene": state.get("scene_id")}))
sys.exit(0 if state["mode"] == "DISARMED" and state["ready"] else 1)

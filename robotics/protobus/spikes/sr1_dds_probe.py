"""Spike S-R1: can a bridge outside the dog compose receive dog topics over CycloneDDS unicast? (read-only)"""
import json, os, time
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy
from nav_msgs.msg import Odometry
from std_msgs.msg import String

SECONDS = float(os.environ.get("SR1_SECONDS", "60"))
rclpy.init()
node = Node("protobus_sr1_probe")
counts = {"odom": 0, "brain_state": 0}
stamps = []
first = {}
def on_odom(msg):
    counts["odom"] += 1
    stamps.append(time.monotonic())
    first.setdefault("odom", time.monotonic())
def on_state(msg):
    counts["brain_state"] += 1
    first.setdefault("brain_state", json.loads(msg.data).get("mode"))
node.create_subscription(Odometry, "/dog1/odom", on_odom, QoSProfile(depth=5, reliability=ReliabilityPolicy.RELIABLE))
node.create_subscription(String, "/dog1/brain/state", on_state, 5)
start = time.monotonic()
while time.monotonic() - start < SECONDS:
    rclpy.spin_once(node, timeout_sec=0.1)
window = [t for t in stamps if t >= start + 5]
rate = (len(window) - 1) / (window[-1] - window[0]) if len(window) > 2 else 0.0
gaps = sorted(b - a for a, b in zip(window, window[1:]))
print(json.dumps({"seconds": SECONDS, "odomMessages": counts["odom"], "odomRateHzAfterWarmup": round(rate, 2),
                  "odomGapP99Ms": round(gaps[int(len(gaps) * 0.99) - 1] * 1000, 1) if gaps else None,
                  "brainStateMessages": counts["brain_state"], "brainMode": first.get("brain_state"),
                  "discoveredNodes": sorted(n for n, _ in node.get_node_names_and_namespaces())}))
node.destroy_node(); rclpy.shutdown()

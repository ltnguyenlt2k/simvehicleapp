"""Read-only DDS fixture capture. No publishers or robot state changes."""
import json
import time
from pathlib import Path
import rclpy
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from rosidl_runtime_py.convert import message_to_ordereddict
from std_msgs.msg import String
from sensor_msgs.msg import Imu, JointState, BatteryState, LaserScan
from nav_msgs.msg import Odometry
from dog_interfaces.msg import FootContacts

rclpy.init()
node = Node('protobus_contract_fixture_capture')
samples = {}
topics = [('brain/state', String), ('motion/state', String), ('sim/state', String),
          ('imu/data', Imu), ('joint_states', JointState), ('battery_state', BatteryState),
          ('scan', LaserScan), ('odom', Odometry), ('foot_contacts', FootContacts)]


def receive(name, msg):
    samples[name] = json.loads(msg.data) if isinstance(msg, String) else message_to_ordereddict(msg)


subscriptions = [node.create_subscription(typ, '/dog1/' + name,
                  lambda msg, name=name: receive(name, msg), qos_profile_sensor_data)
                 for name, typ in topics]
deadline = time.monotonic() + 30
while len(samples) != len(topics) and time.monotonic() < deadline:
    rclpy.spin_once(node, timeout_sec=.1)
node.destroy_node()
rclpy.shutdown()
if len(samples) != len(topics):
    raise SystemExit('Missing real DDS fixtures: ' + str(set(n for n, _ in topics) - samples.keys()))
# ROS floats may be NaN/Inf to indicate unavailable/out-of-range. Preserve them explicitly
# as tagged strings in fixture JSON, not invalid JSON numbers or fabricated zero readings.
def normalize(value):
    if isinstance(value, float):
        import math
        if not math.isfinite(value):
            return {'rosNonFinite': str(value)}
    if isinstance(value, dict):
        return {k: normalize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalize(v) for v in value]
    return value

Path('/evidence/dds-fixtures.json').write_text(json.dumps(normalize(samples), indent=2, allow_nan=False))
print('Captured 9 actual DDS topic fixtures without command publishers')

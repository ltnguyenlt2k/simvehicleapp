"""Read-only ROS subscriptions; bounded mailbox moves mapping work onto owner loop."""
import threading
import time

from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy, qos_profile_sensor_data
from rosidl_runtime_py.utilities import get_message
from mapping import MappingError, field, strict_json

SUPPORTED_TYPES = {
    'sensor_msgs/msg/Imu', 'sensor_msgs/msg/JointState', 'sensor_msgs/msg/BatteryState',
    'sensor_msgs/msg/LaserScan', 'nav_msgs/msg/Odometry', 'dog_interfaces/msg/FootContacts',
    'std_msgs/msg/String', 'rosgraph_msgs/msg/Clock',
}


def capture_stamp(message):
    if hasattr(message, 'header'):
        stamp = message.header.stamp
        if stamp.sec < 0 or not 0 <= stamp.nanosec < 10**9:
            raise MappingError('invalid ROS stamp')
        return stamp.sec*10**9+stamp.nanosec
    if hasattr(message, 'clock'):
        stamp = message.clock
        if stamp.sec < 0 or not 0 <= stamp.nanosec < 10**9:
            raise MappingError('invalid ROS clock')
        return stamp.sec*10**9+stamp.nanosec
    payload = strict_json(field(message, 'data'))
    stamp = field(payload, 'issued_at_ns')
    if type(stamp) is not int or stamp < 0:
        raise MappingError('JSON capture stamp required')
    return stamp


class RosTelemetry:
    def __init__(self, node, engine, loop, epoch):
        self.node, self.engine, self.loop, self.epoch = node, engine, loop, epoch
        self.lock = threading.Lock()
        self.pending = {}
        self.scheduled = False
        self.closed = False
        self.failures = {}
        self.subscriptions = []
        for topic, entries in engine.topics.items():
            mapping = entries[0][1]
            if mapping['type'] not in SUPPORTED_TYPES:
                raise MappingError('unsupported telemetry type: '+mapping['type'])
            qos = (qos_profile_sensor_data if mapping['qos'] == 'sensor_data' else
                   QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE,
                       durability=DurabilityPolicy.TRANSIENT_LOCAL if mapping['qos'] == 'latched'
                       else DurabilityPolicy.VOLATILE))
            name = engine.profile['ros']['namespace'].rstrip('/')+'/'+topic
            self.subscriptions.append(node.create_subscription(get_message(mapping['type']), name,
                lambda message, topic=topic: self.receive(topic, message), qos))

    def receive(self, topic, message):
        try:
            stamp = capture_stamp(message)
            epoch = self.epoch()
            if not epoch:
                raise MappingError('source epoch unavailable')
            received = time.monotonic_ns()
            with self.lock:
                if self.closed:
                    return
                self.pending[topic] = (message, stamp, epoch, received)
                if not self.scheduled:
                    self.scheduled = True
                    self.loop.call_soon_threadsafe(self.drain)
        except (ValueError, TypeError, KeyError, AttributeError) as error:
            with self.lock:
                self.failures[topic] = str(error)[:200]

    def drain(self):
        with self.lock:
            batch, self.pending = self.pending, {}
            self.scheduled = False
            if self.closed:
                return
        for topic, (message, stamp, epoch, received) in batch.items():
            try:
                self.engine.receive(topic, message, source_time_ns=stamp,
                    source_epoch=epoch, now_ns=received)
                with self.lock:
                    self.failures.pop(topic, None)
            except (ValueError, TypeError, KeyError) as error:
                with self.lock:
                    self.failures[topic] = str(error)[:200]

    def close(self):
        with self.lock:
            self.closed = True
            self.pending.clear()
        for subscription in self.subscriptions:
            self.node.destroy_subscription(subscription)
        self.subscriptions.clear()

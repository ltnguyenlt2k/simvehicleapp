"""M24-T01 image/import/RMW check. Not robot transport or actuation evidence."""
import json
import hashlib
import sys
from pathlib import Path
import grpc
import rclpy
from rclpy.utilities import get_rmw_implementation_identifier
from dog_interfaces.msg import ControlRequest, ControlAck, FootContacts, SourceStatus
from geometry_msgs.msg import TwistStamped
from rosgraph_msgs.msg import Clock
from sensor_msgs.msg import Imu
from std_msgs.msg import String
from provider import ProviderClient
from broker import load_catalog
from protobus.v1 import protobus_pb2 as pb


def main():
    assert sys.version_info[:2] == (3, 10), sys.version
    assert get_rmw_implementation_identifier() == 'rmw_cyclonedds_cpp'
    catalog = load_catalog('/contracts/fixtures/rss-go2-catalog.v1.json')
    for message in (ControlRequest, ControlAck, FootContacts, SourceStatus,
                    TwistStamped, Clock, Imu, String):
        message()
    provenance = json.loads(Path('/opt/interface-provenance/manifest.json').read_text())
    assert provenance['commit'] == '25b4bfada838b25ab93cf73c658c356a8ab90ef9'
    for name, digest in provenance['files'].items():
        assert hashlib.sha256((Path('/interface_ws/src')/name).read_bytes()).hexdigest() == digest, name
    rclpy.init()
    node = rclpy.create_node('protobus_image_smoke')
    try:
        node.create_subscription(FootContacts, '/dog1/foot_contacts', lambda _: None, 1)
        rclpy.spin_once(node, timeout_sec=.02)
        print(json.dumps({'passed': True, 'python': sys.version.split()[0],
            'grpc': grpc.__version__, 'rmw': get_rmw_implementation_identifier(),
            'catalogHash': catalog['catalogHash'], 'interfaceCommit': provenance['commit'],
            'scope': 'image/import/RMW only; no actual robot transport or motion'}))
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()

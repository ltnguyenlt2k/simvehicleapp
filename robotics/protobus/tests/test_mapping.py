import copy
import json
import math
from pathlib import Path
import unittest

from broker import load_catalog
from mapping import MappingEngine, MappingError, field, transform
from protobus.v1 import protobus_pb2 as pb


class TransformTests(unittest.TestCase):
    def apply(self, value, op, args=None, message=None):
        return transform(value, {'op': op, **({'args': args} if args else {})}, message)

    def test_scalar_collection_and_json_transforms(self):
        cases = [(2, 'identity', None, 2), (2, 'scale', {'k': .5}, 1),
                 (2, 'offset', {'c': -1}, 1), ([3, float('inf'), 1], 'min_finite', None, 1),
                 ([4, 8], 'array_index', {'index': 1}, 8), ([2, 3], 'count', None, 2),
                 ('MANUAL', 'enum', {'map': {'MANUAL': 'ARMED'}}, 'ARMED'),
                 ('{"a":{"b":7}}', 'json', {'path': '$.a.b'}, 7),
                 (2, 'compare', {'operator': 'lt', 'constant': 3}, True),
                 (2, 'compare', {'operator': 'gt', 'constant': 3}, False),
                 ('x', 'compare', {'operator': 'eq', 'constant': 'x'}, True),
                 (False, 'compare', {'operator': 'ne', 'constant': True}, True)]
        for value, op, args, expected in cases:
            with self.subTest(op=op, args=args):
                self.assertEqual(self.apply(value, op, args), expected)
        self.assertEqual(self.apply([{'name': 'a'}, {'name': 'b'}], 'select',
                                   {'by': 'name', 'equals': 'b'}), {'name': 'b'})

    def test_quaternions_use_normalized_rotation_and_reject_invalid(self):
        for axis, op in [('x', 'quaternion_to_roll'), ('y', 'quaternion_to_pitch'), ('z', 'quaternion_to_yaw')]:
            q = dict(x=0., y=0., z=0., w=2*math.cos(.25))
            q[axis] = 2*math.sin(.25)
            self.assertAlmostEqual(self.apply(q, op), .5)
        for value in [dict(x=0,y=0,z=0,w=0), dict(x=0,y=0,z=0,w=float('nan'))]:
            with self.assertRaises(MappingError):
                self.apply(value, 'quaternion_to_yaw')

    def test_sector_uses_actual_angles_wrap_and_sensor_range(self):
        scan = dict(angle_min=-math.pi, angle_increment=math.pi/4, range_min=.1, range_max=10.)
        # Front is index 4; edge/invalid values cannot turn into artificial zero.
        self.assertEqual(self.apply([.01, .2, .3, .4, 2., .4, .3, .2], 'sector_min', {'degrees': 30}, scan), 2.)
        scan['angle_min'] = 2*math.pi
        self.assertEqual(self.apply([3., 2.], 'sector_min', {'degrees': 30}, scan), 3.)
        with self.assertRaises(MappingError):
            self.apply([float('inf')], 'sector_min', {'degrees': 30}, scan)
        self.assertEqual(self.apply([0., 11., 4.], 'min_finite', message=scan), 4.)

    def test_invalid_missing_and_executable_inputs_are_rejected(self):
        for value, op, args in [(None, 'scale', {'k': 1}), (True, 'scale', {'k': 2}),
                ([float('nan')], 'min_finite', None), ([1], 'array_index', {'index': 2}),
                ([], 'select', {'by': 'name', 'equals': 'x'}),
                ([{'name':'x'}, {'name':'x'}], 'select', {'by':'name','equals':'x'}),
                ('unknown', 'enum', {'map': {'known':'OK'}}),
                ('{"x":1,"x":2}', 'json', {'path':'$.x'}),
                ('{"x":NaN}', 'json', {'path':'$.x'}),
                (1, 'compare', {'constant':True,'operator':'eq'}), (1, 'eval', None)]:
            with self.subTest(op=op, value=value), self.assertRaises((MappingError, ValueError)):
                self.apply(value, op, args)
        for path in ('__class__', 'a[0]', 'x()'):
            with self.assertRaises(MappingError): field({}, path)


class EngineTests(unittest.TestCase):
    def test_dog_profile_matches_captured_ros_data_and_preserves_unknown_battery_status(self):
        root = Path(__file__).parents[1]
        catalog = load_catalog('/contracts/fixtures/rss-go2-catalog.v1.json')
        profile = json.loads((root/'profiles/dog-go2-sim/mapping.json').read_text())
        engine = MappingEngine(catalog, profile)
        engine.reset('capture-fixture')
        fixture = json.loads((root/'fixtures/dog-go2-sim/dds-fixtures.json').read_text())
        for topic in engine.topics:
            message = fixture[topic]
            if topic.endswith('/state'):
                original=message.get('capture_stamp')
                stamp=original['sec']*10**9+original['nanosec'] if original else message['issued_at_ns']
                message = {'data': json.dumps(message)}
            else:
                stamp = message['header']['stamp']['sec']*10**9+message['header']['stamp']['nanosec']
            engine.receive(topic, message, source_time_ns=stamp, source_epoch='capture-fixture')
        self.assertEqual(len(engine.observations), 32)
        unknown = 'Robot.PowerSystem.Battery.IsCharging'
        self.assertEqual(engine.quality(unknown), pb.NONE)
        self.assertIsNone(engine.values()[unknown])
        self.assertEqual(sum(item.quality == pb.OK for item in engine.observations.values()), 31)
        self.assertAlmostEqual(engine.values()['Robot.PowerSystem.Battery.StateOfCharge'], 92., places=4)
        self.assertEqual(engine.values()['Robot.Pose.Position.X'], fixture['odom']['pose']['pose']['position']['x'])
        self.assertEqual(engine.values()['Robot.Velocity.Linear.X'], fixture['odom']['twist']['twist']['linear']['x'])
        self.assertEqual(engine.values()['Robot.Simulation.TimeNs'], fixture['sim/state']['issued_at_ns'])
        self.assertEqual(engine.values()['Robot.Perception.Marker.Count'],1)
        original=fixture['perception/state']['capture_stamp']
        self.assertEqual(engine.sample_metadata('Robot.Perception.Marker.Count')['source_time_ns'],original['sec']*10**9+original['nanosec'])
        self.assertFalse(profile['allowRemoteArm'])

    def setUp(self):
        self.catalog = load_catalog('/contracts/fixtures/rss-go2-catalog.v1.json')
        self.path = 'Robot.Imu.AngularVelocity.X'
        self.profile = dict(schema='mapping.v1', profile='dog-go2-sim', adapter='dog-control/1',
            catalogHash=self.catalog['catalogHash'], backend='SIM',
            ros=dict(domainId=52, namespace='/dog1', useSimTime=True), setpoints={}, commands={},
            sensors={self.path: dict(topic='imu/data',type='sensor_msgs/msg/Imu',
                field='angular_velocity.x',qos='sensor_data',maxRateHz=20)})
        self.engine = MappingEngine(self.catalog, self.profile)
        self.engine.reset('boot/scene')

    def receive(self, value, stamp=100, now=0):
        return self.engine.receive('imu/data', {'angular_velocity':{'x':value}, 'angular_velocity_covariance':[0]*9},
            source_time_ns=stamp, source_epoch='boot/scene', now_ns=now)

    def test_actual_dds_fixture_and_capture_metadata_are_preserved(self):
        fixture = json.loads((Path(__file__).parents[1]/'fixtures/dog-go2-sim/dds-fixtures.json').read_text())
        message = fixture['imu/data']
        stamp = message['header']['stamp']['sec']*10**9+message['header']['stamp']['nanosec']
        self.engine.receive('imu/data', message, source_time_ns=stamp, source_epoch='boot/scene')
        self.assertEqual(self.engine.values()[self.path], message['angular_velocity']['x'])
        self.assertEqual(self.engine.sample_metadata(self.path), dict(source_time_ns=stamp,
                         source_clock='ROS_TIME', source_epoch='boot/scene'))

    def test_rate_limit_freeze_out_of_order_and_explicit_epoch_reset(self):
        self.receive(.1)
        self.assertEqual(self.receive(.2, 101, 10_000_000), [])
        self.assertEqual(self.receive(.3, 102, 50_000_000), [self.path])
        self.assertEqual(self.receive(.4, 102, 100_000_000), [])
        self.assertEqual(self.receive(.5, 99, 200_000_000), [])
        self.assertEqual(self.engine.values()[self.path], .3)
        with self.assertRaises(MappingError):
            self.engine.receive('imu/data', {}, source_time_ns=1, source_epoch='different')
        self.engine.reset('different')
        self.assertEqual(self.engine.values(), {})

    def test_none_transitions_bypass_throttle_and_never_fabricate_zero(self):
        self.receive(.5)
        self.receive(float('nan'), 101, 1)
        self.assertIsNone(self.engine.values()[self.path])
        self.assertEqual(self.engine.quality(self.path), pb.NONE)
        self.receive(.2, 102, 2)
        self.assertEqual(self.engine.values()[self.path], .2)
        self.assertEqual(self.engine.quality(self.path), pb.OK)

    def test_ros_unavailable_covariance_is_not_a_valid_measurement(self):
        message = {'angular_velocity': {'x': .3}, 'angular_velocity_covariance': [-1]+[0]*8}
        self.engine.receive('imu/data', message, source_time_ns=100, source_epoch='boot/scene')
        self.assertEqual(self.engine.quality(self.path), pb.NONE)
        self.assertIsNone(self.engine.values()[self.path])

    def test_profile_rejects_wrong_catalog_broker_owned_and_conflicting_topic_types(self):
        bad = copy.deepcopy(self.profile)
        bad['catalogHash'] = 'sha256:'+'0'*64
        with self.assertRaises(MappingError): MappingEngine(self.catalog, bad)
        bad = copy.deepcopy(self.profile)
        bad['sensors']['Robot.Connection.IsOnline'] = bad['sensors'].pop(self.path)
        with self.assertRaises(MappingError): MappingEngine(self.catalog, bad)
        bad = copy.deepcopy(self.profile)
        bad['sensors']['Robot.Imu.AngularVelocity.Y'] = dict(bad['sensors'][self.path], qos='reliable')
        with self.assertRaises(MappingError): MappingEngine(self.catalog, bad)

    def test_profile_hash_is_canonical_and_input_mutation_cannot_change_active_mapping(self):
        other = dict(reversed(list(self.profile.items())))
        self.assertEqual(self.engine.profile_hash, MappingEngine(self.catalog, other).profile_hash)
        self.profile['sensors'][self.path]['field'] = 'missing'
        self.receive(.25)
        self.assertEqual(self.engine.values()[self.path], .25)
        self.profile['sensors'][self.path]['maxRateHz'] = float('nan')
        with self.assertRaises(ValueError): MappingEngine(self.catalog, self.profile)

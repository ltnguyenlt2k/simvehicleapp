import json
import unittest
from jsonschema import Draft202012Validator
from rssc import CONTRACTS


class MappingContractTests(unittest.TestCase):
    def setUp(self):
        self.validator = Draft202012Validator(json.loads((CONTRACTS / 'mapping.v1.json').read_text()))
        self.profile = {
            'schema': 'mapping.v1', 'profile': 'dog-go2-sim', 'adapter': 'dog-control/1',
            'catalogHash': 'sha256:' + 'a'*64, 'backend': 'SIM', 'allowRemoteArm': False,
            'ros': {'domainId': 52, 'namespace': '/dog1', 'useSimTime': True},
            'sensors': {'Robot.Perception.Obstacle.FrontMinDistance': {
                'topic': 'scan', 'type': 'sensor_msgs/msg/LaserScan', 'field': 'ranges',
                'qos': 'sensor_data', 'maxRateHz': 10,
                'transforms': [{'op': 'sector_min', 'args': {'degrees': 30}}]}},
            'setpoints': {'Robot.Motion.Velocity': {'action': 'manual', 'fields': {'LinearX': 'linear', 'AngularZ': 'angular'}}},
            'commands': {'Robot.Safety.Stop': {'action': 'stop', 'priority': 'emergency'}}}

    def test_valid_closed_mapping_profile(self):
        self.validator.validate(self.profile)

    def test_real_backend_and_wrong_catalog_are_rejected(self):
        self.profile['backend'] = 'REAL'
        self.assertFalse(self.validator.is_valid(self.profile))
        self.profile['backend'] = 'SIM'
        self.profile['catalogHash'] = 'unversioned'
        self.assertFalse(self.validator.is_valid(self.profile))

    def test_transform_execution_and_unknown_properties_are_rejected(self):
        sensor = next(iter(self.profile['sensors'].values()))
        for transform in [{'op': 'eval', 'args': {'code': 'arbitrary'}},
                          {'op': 'scale', 'args': {'k': 'not a number'}},
                          {'op': 'sector_min', 'args': {'degrees': 400}},
                          {'op': 'array_index', 'args': {'index': -1}},
                          {'op': 'identity', 'args': {'unexpected': True}}]:
            with self.subTest(transform=transform):
                sensor['transforms'] = [transform]
                self.assertFalse(self.validator.is_valid(self.profile))

    def test_no_direct_motor_or_safe_command_publisher_config(self):
        for action in ['cmd_vel', 'LowCmd', 'sim/request', 'motion/request']:
            with self.subTest(action=action):
                self.profile['commands']['Robot.Safety.Stop']['action'] = action
                self.assertFalse(self.validator.is_valid(self.profile))

    def test_qos_and_sim_clock_required(self):
        next(iter(self.profile['sensors'].values()))['qos'] = 'arbitrary'
        self.assertFalse(self.validator.is_valid(self.profile))
        next(iter(self.profile['sensors'].values()))['qos'] = 'reliable'
        self.profile['ros']['useSimTime'] = False
        self.assertFalse(self.validator.is_valid(self.profile))

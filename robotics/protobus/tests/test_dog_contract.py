"""Pinned producer wire artifact only; never import dog implementation code."""
import hashlib
import ast
import json
from pathlib import Path
import unittest
from jsonschema import Draft202012Validator


class DogContractTests(unittest.TestCase):
    def setUp(self):
        self.root = Path('/contracts')
        self.schema = json.loads((self.root/'dog-control-authority.v1.json').read_text())
        self.validator = Draft202012Validator(self.schema)

    def packet(self):
        return dict(schema='dog-control-authority.v1', source='protobus', session='provider-session',
            brain_boot_id='brain-boot', scene_epoch='scene', host_clock_id='linux-boot',
            challenge='current-challenge', grant_id='', sequence=1,
            valid_until_monotonic_ns=1234567890123456789)

    def test_exact_producer_pin_and_license_are_preserved(self):
        metadata = json.loads((self.root/'dog-control-authority.provenance.json').read_text())
        self.assertRegex(metadata['commit'], r'^[a-f0-9]{40}$')
        self.assertEqual(hashlib.sha256((self.root/'dog-control-authority.v1.json').read_bytes()).hexdigest(), metadata['sha256'])
        self.assertEqual(metadata['license'], 'Apache-2.0')
        self.assertEqual(metadata['adaptations'], [])
        self.assertIn('Apache License', (self.root/'licenses/dog-ros2-simulation-LICENSE').read_text())
        self.assertEqual(hashlib.sha256((self.root/'licenses/dog-ros2-simulation-LICENSE').read_bytes()).hexdigest(), metadata['licenseSha256'])

    def test_controller_wire_accepts_exact_integer_fields(self):
        Draft202012Validator.check_schema(self.schema)
        self.validator.validate(self.packet())

    def test_ros_application_has_exactly_one_allowed_command_publisher(self):
        root=Path(__file__).resolve().parents[1]
        calls=[]
        for name in ('dog_ros_link.py','ros_telemetry.py','dog_backend.py','ros_bridge.py'):
            tree=ast.parse((root/name).read_text())
            calls.extend(node for node in ast.walk(tree) if isinstance(node,ast.Call)
                and isinstance(node.func,ast.Attribute) and node.func.attr=='create_publisher')
        self.assertEqual(len(calls),1)
        topic=calls[0].args[1]
        self.assertIsInstance(topic,ast.BinOp)
        self.assertIsInstance(topic.op,ast.Add)
        self.assertEqual(topic.right.value,'/control/request')

    def test_controller_wire_rejects_bool_overflow_unknown_fields_and_wrong_source(self):
        for changes in [dict(sequence=True), dict(sequence=2**64),
                        dict(valid_until_monotonic_ns=2**63), dict(valid_until_monotonic_ns='123'),
                        dict(source='operator'), dict(arbitrary_action='shell')]:
            with self.subTest(changes=changes):
                self.assertFalse(self.validator.is_valid(dict(self.packet(), **changes)))

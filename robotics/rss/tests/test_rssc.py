import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from rssc import RSSFailure, build, canonical, check_value, convert, documentation, load


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.spec = load(Path(__file__).resolve().parents[1] / 'spec/go2.rss.yaml')

    def reject(self, spec, code):
        with self.assertRaises(RSSFailure) as caught:
            build(spec)
        self.assertEqual(caught.exception.code, code)

    def test_catalog_and_hash_independent_of_input_order(self):
        first = build(self.spec)
        self.spec['nodes'] = dict(reversed(list(self.spec['nodes'].items())))
        second = build(self.spec)
        self.assertEqual(canonical(first), canonical(second))
        saved = second.pop('catalogHash')
        self.assertEqual(saved, 'sha256:' + hashlib.sha256(canonical(second)).hexdigest())
        self.assertGreaterEqual(len(first['nodes']), 100)

    def test_instances_and_command_status(self):
        nodes = build(self.spec)['nodes']
        for leg in ('FrontLeft', 'FrontRight', 'RearLeft', 'RearRight'):
            for joint in ('Hip', 'Thigh', 'Calf'):
                self.assertIn(f'Robot.Leg.{leg}.Joint.{joint}.Position', nodes)
        self.assertTrue(nodes['Robot.Motion.Perform.Status.Phase']['generated'])
        self.assertIn('TIMED_OUT', nodes['Robot.Motion.Perform.Status.Phase']['values'])

    def test_schema_required_properties(self):
        for path, field in [('Robot.Imu.AngularVelocity.X', 'maxAgeMs'),
                            ('Robot.Motion.Velocity', 'ttlMs'),
                            ('Robot.Motion.Perform', 'timeoutMs')]:
            with self.subTest(field=field):
                spec = copy.deepcopy(self.spec)
                del spec['nodes'][path][field]
                self.reject(spec, 'RSS1001')

    def test_duplicate_expansion_and_generated_collision(self):
        self.spec['nodes']['Robot.Leg.FrontLeft.Foot.IsInContact'] = {'kind': 'sensor', 'type': 'bool', 'maxAgeMs': 200}
        self.reject(self.spec, 'RSS1002')
        del self.spec['nodes']['Robot.Leg.FrontLeft.Foot.IsInContact']
        self.spec['nodes']['Robot.Safety.Stop.Status.Phase'] = {'kind': 'sensor', 'type': 'string', 'maxAgeMs': 200}
        self.reject(self.spec, 'RSS1002')

    def test_yaml_duplicate_key_not_silently_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'duplicate.yaml'
            path.write_text('rss: "0.1"\nrss: "0.2"\n')
            with self.assertRaisesRegex(RSSFailure, 'RSS1002'):
                load(path)

    def test_unknown_unit(self):
        self.spec['nodes']['Robot.Imu.AngularVelocity.X']['unit'] = 'furlong'
        self.reject(self.spec, 'RSS2001')

    def test_invalid_range_and_safe_value(self):
        target = self.spec['nodes']['Robot.Motion.Velocity']
        target['safeValue']['LinearX'] = 1.0
        self.reject(self.spec, 'RSS2004')
        target['safeValue']['LinearX'] = 0.0
        target['fields']['LinearX']['min'] = 2
        self.reject(self.spec, 'RSS2004')

    def test_safe_struct_must_be_complete_and_strictly_typed(self):
        target = self.spec['nodes']['Robot.Motion.Velocity']
        for value in ({'LinearX': 0}, {'LinearX': 0, 'AngularZ': False}, {'LinearX': 0, 'AngularZ': 0, 'extra': 0}):
            with self.subTest(value=value):
                target['safeValue'] = value
                self.reject(self.spec, 'RSS2003')

    def test_period_must_be_shorter_than_ttl(self):
        self.spec['nodes']['Robot.Motion.Velocity']['ttlMs'] = 50
        self.reject(self.spec, 'RSS2005')

    def test_nonfinite_bounds_and_values(self):
        for value in (float('nan'), float('inf'), -float('inf')):
            with self.subTest(value=value):
                spec = copy.deepcopy(self.spec)
                spec['nodes']['Robot.Motion.Velocity']['safeValue']['LinearX'] = value
                self.reject(spec, 'RSS2003')
                spec = copy.deepcopy(self.spec)
                spec['nodes']['Robot.Motion.Velocity']['fields']['LinearX']['max'] = value
                self.reject(spec, 'RSS2004')

    def test_invalid_names_instances_and_enum(self):
        spec = copy.deepcopy(self.spec)
        spec['nodes']['Robot.Leg[FrontLeft,FrontLeft].X'] = {'kind': 'sensor', 'type': 'bool', 'maxAgeMs': 1}
        self.reject(spec, 'RSS1003')
        spec = copy.deepcopy(self.spec)
        spec['nodes']['robot.bad'] = {'kind': 'branch'}
        self.reject(spec, 'RSS1003')
        del self.spec['nodes']['Robot.Motion.Perform']['args']['Name']['values']
        self.reject(self.spec, 'RSS2003')

    def test_units_dimension_offset_and_scale(self):
        self.assertEqual(convert(100, 'cm', 'm'), 1)
        self.assertEqual(convert(1000, 'ms', 's'), 1)
        self.assertEqual(convert(20, '%', '1'), .2)
        self.assertAlmostEqual(convert(0, '°C', 'K'), 273.15)
        self.assertEqual(convert(-20,'°C','K'),253.15)
        self.assertEqual(convert(253.15,'K','°C'),-20.)
        with self.assertRaisesRegex(RSSFailure, 'RSS2002'):
            convert(1, 'm', 's')
        with self.assertRaisesRegex(RSSFailure, 'RSS2001'):
            convert(1, 'unknown', 's')

    def test_unit_conversion_rejects_bool_nonfinite_and_overflow(self):
        for value in (True,float('nan'),float('inf'),2**2000):
            with self.subTest(value=value),self.assertRaisesRegex(RSSFailure,'RSS2003'):
                convert(value,'m','cm')
        with self.assertRaisesRegex(RSSFailure,'RSS2003'): convert(1e308,'m','cm')

    def test_unit_contract_change_preserves_frozen_catalog_bytes(self):
        expected=json.loads(Path('/contracts/fixtures/rss-go2-catalog.v1.json').read_text())
        self.assertEqual(canonical(build(self.spec)),canonical(expected))

    def test_scalar_bounds_and_bool_are_not_integers(self):
        for value, field in [(True, {'type': 'int32'}), (256, {'type': 'uint8'}),
                              (2**63, {'type': 'int64'}), (1e39, {'type': 'float32'}),
                              ('UNKNOWN', {'type': 'enum', 'values': ['MANUAL']})]:
            with self.subTest(value=value):
                with self.assertRaisesRegex(RSSFailure, 'RSS2003'):
                    check_value(value, field, 'test')

    def test_docs_cover_expanded_paths(self):
        catalog = build(self.spec)
        text = documentation(catalog)
        for path in catalog['nodes']:
            self.assertIn('| ' + path + ' |', text)

    def test_topic_traceability_and_deployment_remains_disarmed(self):
        profile_dir = Path(__file__).resolve().parents[1] / 'profiles/dog-go2-sim'
        matrix = json.loads((profile_dir / 'topic-traceability.json').read_text())
        self.assertEqual(matrix['topicCount'], 48)
        self.assertEqual(len(matrix['topics']), matrix['topicCount'])
        self.assertEqual(len({item['topic'] for item in matrix['topics']}), 48)
        for item in matrix['topics']:
            self.assertIn(item['disposition'], ('mapped', 'outside_scope'))
            self.assertTrue(item['reason'])
            self.assertTrue(item['type'])
            self.assertEqual(bool(item['rss']), item['disposition'] == 'mapped')
        profile = json.loads((profile_dir / 'profile.json').read_text())
        self.assertEqual(profile['backend'], 'SIM')
        self.assertFalse(profile['allowRemoteArm'])
        self.assertTrue(profile['requiresExplicitRunAuthorization'])


if __name__ == '__main__':
    unittest.main()

"""Synthetic wire edge cases; actual ROS acceptance is tracked separately in M24."""
import copy
import json
import unittest
from dog_protocol import DogProtocol, DogProtocolError, mission_result, motion_result
from provider import RejectedBeforeStart


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.now = 10_000_000_000
        self.frame = dict(schema=1, source='SIM', config_hash='a'*64, boot_id='brain',
            scene_epoch='scene', issued_at_ns=1234, mode='DISARMED', ready=True, active_motion_id=None,
            authority=dict(schema='dog-control-authority.v1', host_clock_id='host', enabled=True,
                           challenge='challenge', owner=None))
        self.protocol = DogProtocol('host')
        self.protocol.update_brain(self.frame, self.now)

    def claim(self):
        request = self.protocol.controller('provider', self.now, self.now+500_000_000, 'claim')
        owner = {key: request[key] for key in ('source','session','brain_boot_id','scene_epoch','host_clock_id')}
        owner['grant_id'] = 'grant'
        ack = dict(accepted=True, authority=dict(owner=owner))
        self.protocol.accept_claim(request, ack)
        self.assertFalse(self.protocol.owns(), 'ACK alone is not an observed Brain state')
        self.frame['authority']['owner'] = owner
        self.frame['authority']['challenge'] = 'next-challenge'
        self.frame['issued_at_ns'] += 1
        self.protocol.update_brain(self.frame, self.now)
        return request, ack

    def test_claim_is_explicit_and_bounded_by_lease_and_absolute_validity(self):
        packet = self.protocol.controller('provider', self.now, self.now+200_000_000, 'claim')
        self.assertEqual(packet['valid_until_monotonic_ns'], self.now+200_000_000)
        self.assertEqual(packet['grant_id'], '')
        self.assertFalse(self.protocol.owns())
        self.assertEqual(json.loads(json.dumps(packet))['valid_until_monotonic_ns'], self.now+200_000_000)
        for deadline in (self.now, self.now-1, True):
            with self.assertRaises(DogProtocolError):
                self.protocol.controller('provider', self.now, deadline, 'claim')

    def test_observed_owner_renew_and_command_keep_identity_and_do_not_reclaim(self):
        request, ack = self.claim()
        self.assertTrue(self.protocol.owns())
        packet = self.protocol.controller('provider', self.now, self.now+800_000_000)
        self.assertEqual(packet['grant_id'], 'grant')
        self.assertLessEqual(packet['valid_until_monotonic_ns'], self.protocol.grant_deadline)
        with self.assertRaises(DogProtocolError):
            self.protocol.controller('competitor', self.now, self.now+800_000_000)
        with self.assertRaises(DogProtocolError):
            self.protocol.controller('provider', self.now, self.now+800_000_000, 'claim')
        renewal = self.protocol.controller('provider', self.now+100_000_000, self.now+800_000_000, 'renew')
        self.protocol.accept_renew(renewal, ack)
        self.assertEqual(self.protocol.grant_deadline, renewal['valid_until_monotonic_ns'])
        with self.assertRaises(DogProtocolError):
            self.protocol.controller('provider', self.now+500_000_000, self.now+900_000_000, 'renew')

    def test_claim_ack_wrong_identity_or_rejection_cannot_create_authority(self):
        self.assertFalse(issubclass(DogProtocolError, RejectedBeforeStart),
                         'a protocol error after sending cannot prove no physical admission')
        request = self.protocol.controller('provider', self.now, self.now+500_000_000, 'claim')
        for ack in (dict(accepted=1), dict(accepted=False),
                    dict(accepted=True, authority=dict(owner={'grant_id':'fake','session':'other'})),
                    dict(accepted=True, authority=dict(owner=['malformed']))):
            with self.subTest(ack=ack), self.assertRaises(DogProtocolError):
                self.protocol.accept_claim(request, ack)
            self.assertEqual(self.protocol.grant_id, '')

    def test_epoch_change_clears_grant_and_clock_regression_or_stale_frame_blocks_writes(self):
        self.claim()
        frame = copy.deepcopy(self.frame)
        frame['boot_id'], frame['issued_at_ns'], frame['authority']['owner'] = 'new-brain', 1, None
        self.assertTrue(self.protocol.update_brain(frame, self.now))
        self.assertEqual(self.protocol.grant_id, '')
        with self.assertRaises(DogProtocolError):
            self.protocol.controller('provider', self.now, self.now+500_000_000)
        frame['issued_at_ns'] = 0
        with self.assertRaises(DogProtocolError): self.protocol.update_brain(frame, self.now)
        with self.assertRaises(DogProtocolError):
            self.protocol.controller('provider', self.now+300_000_001, self.now+800_000_000, 'claim')

    def test_unowned_recovery_requires_stop_and_cannot_supply_a_grant(self):
        self.frame['mode'] = 'SAFE_STOP'
        self.protocol.update_brain(self.frame, self.now)
        packet = self.protocol.controller('provider', self.now, self.now+500_000_000, 'reset')
        self.assertEqual(packet['grant_id'], '')
        with self.assertRaises(DogProtocolError):
            self.protocol.controller('provider', self.now, self.now+500_000_000, 'claim')
        with self.assertRaises(DogProtocolError):
            self.protocol.controller('provider', self.now, self.now+500_000_000)

    def test_envelope_preserves_hash_time_id_and_closed_actions(self):
        payload = self.protocol.envelope('stop', 'request', 9999)
        self.assertEqual(payload, dict(schema=1, source='SIM', config_hash='a'*64,
                                      action='stop', request_id='request', issued_at_ns=9999))
        for action, fields in [('sim/request', {}), ('stop', {'config_hash':'override'})]:
            with self.assertRaises(DogProtocolError):
                self.protocol.envelope(action, 'request', 9999, **fields)
        with self.assertRaises(DogProtocolError): self.protocol.envelope('stop','request', True)
        with self.assertRaises(DogProtocolError): self.protocol.envelope('arm','request', 9999)

    def test_source_host_mode_and_protocol_mismatches_fail_before_request_generation(self):
        for changes in (dict(source='REAL'), dict(issued_at_ns=True), dict(mode='UNKNOWN'),
                        dict(authority=[]), dict(config_hash='unversioned')):
            with self.subTest(changes=changes), self.assertRaises(DogProtocolError):
                self.protocol.update_brain(dict(self.frame, **changes), self.now)

    def test_actual_terminal_identity_rules_reject_unrelated_or_active_motion(self):
        self.claim()
        packet = self.protocol.controller('provider',self.now,self.now+500_000_000)
        request = self.protocol.envelope('motion','motion-id', 100, packet)
        result = dict(schema=1,source='SIM',config_hash='a'*64,scene_epoch='scene',
                      motion_id='motion-id',issued_at_ns=200,phase='SUCCEEDED',active=False)
        self.assertEqual(motion_result(result, request, 'scene'), 'SUCCEEDED')
        for changes in (dict(motion_id='old'),dict(scene_epoch='old'),dict(issued_at_ns=99),
                        dict(active=True),dict(phase='RUNNING')):
            self.assertIsNone(motion_result(dict(result,**changes), request,'scene'))

    def test_navigation_matches_stable_mission_and_map_for_success(self):
        self.claim()
        packet = self.protocol.controller('provider',self.now,self.now+500_000_000)
        request = self.protocol.envelope('goal','goal-id', 100,packet,map_generation='map-1',goal_frame='map')
        result = dict(self.frame,mission_id='goal-id',mission='SUCCEEDED',issued_at_ns=200,map_generation='map-1')
        self.assertEqual(mission_result(result,request,'brain','scene'),'SUCCEEDED')
        for changes in (dict(mission_id='other'),dict(map_generation='map-2'),dict(boot_id='old')):
            self.assertIsNone(mission_result(dict(result,**changes),request,'brain','scene'))
        self.assertEqual(mission_result(dict(result,mission='CANCELLED',map_generation='map-2'),request,'brain','scene'),'CANCELLED')

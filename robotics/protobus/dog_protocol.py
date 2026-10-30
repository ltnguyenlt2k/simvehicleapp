"""dog-control/1 request/identity kernel. Wire artifacts only; no dog runtime imports."""
import hashlib
import json
from pathlib import Path
import re

from jsonschema import Draft202012Validator, ValidationError


class DogProtocolError(ValueError):
    """Protocol failure; it does not prove a previously sent action never ran."""
    pass


class DogProtocol:
    def __init__(self, host_clock_id):
        self.host_clock_id = host_clock_id
        self.validator = Draft202012Validator(json.loads(Path('/contracts/dog-control-authority.v1.json').read_text()))
        self.brain = None
        self.received_ns = 0
        self.source_epoch = None
        self.clear_grant()

    def clear_grant(self):
        self.sequence = 0
        self.grant_id = ''
        self.grant_deadline = 0
        self.grant_session = None

    def update_brain(self, payload, received_ns):
        if not isinstance(payload, dict) or payload.get('schema') != 1 or payload.get('source') != 'SIM':
            raise DogProtocolError('dog schema/SIM source mismatch')
        for key in ('boot_id', 'scene_epoch'):
            if not isinstance(payload.get(key), str) or not 1 <= len(payload[key]) <= 128:
                raise DogProtocolError('dog boot/scene identity unavailable')
        if not isinstance(payload.get('config_hash'), str) or not re.fullmatch('[a-f0-9]{64}', payload['config_hash']):
            raise DogProtocolError('dog config hash unavailable')
        authority = payload.get('authority', {})
        if (not isinstance(authority, dict) or authority.get('schema') != 'dog-control-authority.v1'
                or authority.get('host_clock_id') != self.host_clock_id):
            raise DogProtocolError('dog authority/host clock mismatch')
        if (type(authority.get('enabled')) is not bool
                or not isinstance(authority.get('challenge'), str) or not 1 <= len(authority['challenge']) <= 128
                or (authority.get('owner') is not None and not isinstance(authority['owner'], dict))
                or payload.get('mode') not in ('DISARMED', 'MANUAL', 'AUTO', 'MOTION', 'SAFE_STOP')
                or type(payload.get('ready')) is not bool):
            raise DogProtocolError('invalid dog authority/state fields')
        stamp = payload.get('issued_at_ns')
        if type(stamp) is not int or not 0 <= stamp < 2**63:
            raise DogProtocolError('dog source timestamp unavailable')
        identity = [payload[key] for key in ('boot_id', 'scene_epoch', 'config_hash')]
        epoch = 'dog:'+hashlib.sha256(json.dumps(identity, separators=(',', ':')).encode()).hexdigest()
        changed = self.source_epoch is not None and epoch != self.source_epoch
        if self.brain and not changed and stamp < self.brain['issued_at_ns']:
            raise DogProtocolError('dog ROS clock moved backwards within source epoch')
        if changed:
            self.clear_grant()
        self.source_epoch = epoch
        self.brain = json.loads(json.dumps(payload, allow_nan=False))
        self.received_ns = received_ns
        return changed

    def require_frame(self, now):
        if self.brain is None or not 0 <= now-self.received_ns <= 300_000_000:
            raise DogProtocolError('fresh dog Brain frame required')
        return self.brain

    def owns(self):
        if not self.brain or not self.grant_id:
            return False
        owner = self.brain['authority'].get('owner') or {}
        return (owner.get('grant_id') == self.grant_id and owner.get('session') == self.grant_session
                and owner.get('brain_boot_id') == self.brain['boot_id']
                and owner.get('scene_epoch') == self.brain['scene_epoch'])

    def controller(self, session, now, lease_deadline, operation='command'):
        frame = self.require_frame(now)
        if not frame['authority'].get('enabled'):
            raise DogProtocolError('external control disabled by Brain')
        if type(lease_deadline) is not int or lease_deadline <= now:
            raise DogProtocolError('broker authority expired')
        if operation == 'claim':
            if (self.grant_id or frame.get('mode') != 'DISARMED' or not frame.get('ready')
                    or frame.get('active_motion_id') or frame['authority'].get('owner')):
                raise DogProtocolError('claim requires fresh healthy unowned DISARMED state')
            deadline, grant = min(lease_deadline, now+400_000_000), ''
        elif operation == 'reset':
            if frame.get('mode') != 'SAFE_STOP' or frame['authority'].get('owner') or frame.get('active_motion_id'):
                raise DogProtocolError('unowned reset requires stopped recovery-complete state')
            deadline, grant = min(lease_deadline, now+300_000_000), ''
        elif operation in ('renew', 'command'):
            if not self.owns() or session != self.grant_session or now >= self.grant_deadline:
                raise DogProtocolError('current observed Brain grant required; no automatic reclaim')
            deadline = min(lease_deadline, now+400_000_000) if operation == 'renew' else min(lease_deadline, self.grant_deadline, now+300_000_000)
            grant = self.grant_id
        else:
            raise DogProtocolError('unknown controller operation')
        self.sequence += 1
        packet = dict(schema='dog-control-authority.v1', source='protobus', session=session,
            brain_boot_id=frame['boot_id'], scene_epoch=frame['scene_epoch'], host_clock_id=self.host_clock_id,
            challenge=frame['authority'].get('challenge'), grant_id=grant, sequence=self.sequence,
            valid_until_monotonic_ns=deadline)
        try:
            self.validator.validate(packet)
        except ValidationError as error:
            raise DogProtocolError('invalid controller packet') from error
        return packet

    def accept_claim(self, request, ack):
        if ack.get('accepted') is not True:
            raise DogProtocolError('Brain rejected authority claim: '+str(ack.get('reason', 'unknown')))
        owner = ack.get('authority', {}).get('owner') or {}
        if (not isinstance(owner, dict) or not isinstance(owner.get('grant_id'), str) or not owner['grant_id']
                or any(owner.get(key) != request[key] for key in
                    ('source', 'session', 'brain_boot_id', 'scene_epoch', 'host_clock_id'))):
            raise DogProtocolError('Brain claim ACK owner identity mismatch')
        self.grant_id = owner['grant_id']
        self.grant_session = request['session']
        self.grant_deadline = request['valid_until_monotonic_ns']

    def accept_renew(self, request, ack):
        if (ack.get('accepted') is not True or request['grant_id'] != self.grant_id
                or request['session'] != self.grant_session):
            raise DogProtocolError('Brain renewal rejected or mismatched')
        owner = ack.get('authority', {}).get('owner') or {}
        if (not isinstance(owner, dict) or owner.get('grant_id') != self.grant_id or any(owner.get(key) != request[key]
                for key in ('source', 'session', 'brain_boot_id', 'scene_epoch', 'host_clock_id'))):
            raise DogProtocolError('Brain renewal ACK owner identity mismatch')
        self.grant_deadline = request['valid_until_monotonic_ns']

    def envelope(self, action, request_id, ros_time_ns, controller=None, **fields):
        if self.brain is None:
            raise DogProtocolError('dog identity unavailable')
        if action not in ('authority_claim', 'authority_renew', 'authority_release',
                          'manual', 'arm', 'disarm', 'stop', 'reset_stop', 'motion',
                          'motion_cancel', 'goal', 'route', 'cancel'):
            raise DogProtocolError('unsupported dog control action')
        if type(ros_time_ns) is not int or not 0 <= ros_time_ns < 2**63:
            raise DogProtocolError('valid ROS clock required')
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128:
            raise DogProtocolError('request identity required')
        protected = {'schema', 'source', 'config_hash', 'issued_at_ns', 'request_id', 'action', 'controller'}
        if protected.intersection(fields):
            raise DogProtocolError('request fields cannot override envelope identity')
        payload = dict(schema=1, source='SIM', config_hash=self.brain['config_hash'],
            issued_at_ns=ros_time_ns, request_id=request_id, action=action, **fields)
        if controller is not None:
            try:
                self.validator.validate(controller)
            except ValidationError as error:
                raise DogProtocolError('invalid controller packet') from error
            payload['controller'] = dict(controller)
            if action not in ('authority_claim', 'reset_stop', 'stop', 'disarm') and not controller['grant_id']:
                raise DogProtocolError('body/control request requires a Brain grant')
        elif action not in ('stop', 'disarm'):
            raise DogProtocolError('provider cannot use the legacy operator control path')
        return payload


TERMINALS = {'SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELLED'}


def motion_result(payload, request, source_scene):
    if (not isinstance(payload, dict) or payload.get('schema') != 1 or payload.get('source') != 'SIM'
            or payload.get('config_hash') != request['config_hash']
            or payload.get('scene_epoch') != source_scene
            or payload.get('motion_id') != request['request_id']
            or type(payload.get('issued_at_ns')) is not int
            or payload['issued_at_ns'] < request['issued_at_ns']):
        return None
    phase = payload.get('phase')
    return phase if phase in TERMINALS and payload.get('active') is False else None


def mission_result(brain, request, source_boot, source_scene):
    if (not isinstance(brain, dict) or brain.get('schema') != 1 or brain.get('source') != 'SIM'
            or brain.get('config_hash') != request['config_hash'] or brain.get('boot_id') != source_boot
            or brain.get('scene_epoch') != source_scene or brain.get('mission_id') != request['request_id']
            or type(brain.get('issued_at_ns')) is not int or brain['issued_at_ns'] < request['issued_at_ns']):
        return None
    phase = brain.get('mission')
    if phase == 'SUCCEEDED' and brain.get('map_generation') != request.get('map_generation'):
        return None
    return phase if phase in TERMINALS else None

"""Closed RSS mapping transforms and capture-preserving telemetry store. No ROS imports."""
from collections import defaultdict
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import re
import time

from jsonschema import Draft202012Validator
from provider import scalar_value, scalar_from_wire
from protobus.v1 import protobus_pb2 as pb


class MappingError(ValueError):
    pass


def field(value, path):
    if not path:
        return value
    for name in path.split('.'):
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', name):
            raise MappingError('invalid field path')
        try:
            value = value[name] if isinstance(value, dict) else getattr(value, name)
        except (KeyError, AttributeError, TypeError) as error:
            raise MappingError('unavailable field '+path) from error
        if callable(value):
            raise MappingError('callable field prohibited')
    return value


def number(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise MappingError('finite number required')
    return value


def sequence(value):
    if isinstance(value, (str, bytes, dict)) or not hasattr(value, '__iter__'):
        raise MappingError('array required')
    # ROS fixed numeric arrays may be NumPy arrays; convert their scalars to
    # native Python values without making NumPy a broker dependency.
    return value.tolist() if hasattr(value, 'tolist') else list(value)


def strict_json(value):
    if not isinstance(value, str):
        return value
    def pairs(items):
        result = {}
        for key, item in items:
            if key in result:
                raise MappingError('duplicate JSON key')
            result[key] = item
        return result
    def invalid(_):
        raise MappingError('nonfinite JSON value')
    return json.loads(value, object_pairs_hook=pairs, parse_constant=invalid)


def transform(value, operation, message=None):
    op, args = operation['op'], operation.get('args', {})
    if op == 'identity':
        return value
    if op == 'scale':
        return number(value)*number(args['k'])
    if op == 'offset':
        return number(value)+number(args['c'])
    if op.startswith('quaternion_to_'):
        x, y, z, w = (number(field(value, key)) for key in ('x', 'y', 'z', 'w'))
        norm = math.sqrt(x*x+y*y+z*z+w*w)
        if norm < 1e-12 or not math.isfinite(norm):
            raise MappingError('invalid quaternion norm')
        x, y, z, w = (item/norm for item in (x, y, z, w))
        if op == 'quaternion_to_roll':
            return math.atan2(2*(w*x+y*z), 1-2*(x*x+y*y))
        if op == 'quaternion_to_pitch':
            return math.asin(max(-1., min(1., 2*(w*y-z*x))))
        if op == 'quaternion_to_yaw':
            return math.atan2(2*(w*z+x*y), 1-2*(y*y+z*z))
        raise MappingError('unknown quaternion transform')
    if op == 'min_finite':
        values = [item for item in sequence(value)
                  if type(item) in (int, float) and math.isfinite(item)]
        if message is not None and ((isinstance(message, dict) and 'range_min' in message)
                                    or hasattr(message, 'range_min')):
            low, high = number(field(message, 'range_min')), number(field(message, 'range_max'))
            values = [item for item in values if low <= item <= high]
        if not values:
            raise MappingError('no finite measurement')
        return min(values)
    if op == 'sector_min':
        start, increment = number(field(message, 'angle_min')), number(field(message, 'angle_increment'))
        minimum, maximum = number(field(message, 'range_min')), number(field(message, 'range_max'))
        if increment == 0 or maximum < minimum:
            raise MappingError('invalid scan geometry')
        half = math.radians(number(args['degrees']))/2
        values = []
        for index, item in enumerate(sequence(value)):
            angle = math.atan2(math.sin(start+index*increment), math.cos(start+index*increment))
            if (abs(angle) <= half+1e-9 and type(item) in (int, float)
                    and math.isfinite(item) and minimum <= item <= maximum):
                values.append(item)
        if not values:
            raise MappingError('no valid sector measurement')
        return min(values)
    if op == 'array_index':
        values = sequence(value)
        if not 0 <= args['index'] < len(values):
            raise MappingError('array index unavailable')
        return values[args['index']]
    if op == 'select':
        selected = [item for item in sequence(value) if field(item, args['by']) == args['equals']]
        if len(selected) != 1:
            raise MappingError('selection must match exactly one element')
        return selected[0]
    if op == 'json':
        return field(strict_json(value), args['path'].removeprefix('$').removeprefix('.'))
    if op == 'enum':
        key = json.dumps(value) if type(value) is bool else str(value)
        if key not in args['map']:
            raise MappingError('unmapped enum')
        return args['map'][key]
    if op == 'count':
        return len(sequence(value))
    if op == 'compare':
        other = args['constant']
        if type(value) is bool or type(other) is bool:
            if type(value) is not type(other):
                raise MappingError('comparison type mismatch')
        elif isinstance(value, str) or isinstance(other, str):
            if not isinstance(value, str) or not isinstance(other, str):
                raise MappingError('comparison type mismatch')
        else:
            number(value)
            number(other)
        operator = args['operator']
        if operator == 'eq': return value == other
        if operator == 'ne': return value != other
        if operator == 'lt': return value < other
        if operator == 'gt': return value > other
        raise MappingError('unknown comparison')
    raise MappingError('unknown transform '+op)


@dataclass(frozen=True)
class Observation:
    value: object
    quality: int
    source_time_ns: int
    source_epoch: str
    source_clock: str


class MappingEngine:
    def __init__(self, catalog, profile, schema_path='/contracts/mapping.v1.json'):
        canonical = json.dumps(profile, sort_keys=True, separators=(',', ':'),
                               ensure_ascii=False, allow_nan=False).encode()
        profile = json.loads(canonical)
        self.profile_hash = 'sha256:'+hashlib.sha256(canonical).hexdigest()
        Draft202012Validator(json.loads(Path(schema_path).read_text())).validate(profile)
        if profile['catalogHash'] != catalog['catalogHash']:
            raise MappingError('catalog hash mismatch')
        self.catalog, self.profile = catalog, profile
        self.topics = defaultdict(list)
        self.observations = {}
        self.last_sent = {}
        self.last_capture = {}
        self.epoch = None
        self.errors = {}
        for path, mapping in profile['sensors'].items():
            node = catalog['nodes'].get(path, {})
            if node.get('kind') not in ('sensor', 'attribute') or node.get('generated') or path.startswith('Robot.Connection.'):
                raise MappingError('not a provider observation: '+path)
            self.topics[mapping['topic']].append((path, mapping))
        for entries in self.topics.values():
            if len({(item['type'], item['qos']) for _, item in entries}) != 1:
                raise MappingError('one topic must use one type and QoS')
        for section, kind in (('setpoints', 'setpoint'), ('commands', 'command')):
            for path, mapping in profile[section].items():
                node = catalog['nodes'].get(path, {})
                if node.get('kind') != kind:
                    raise MappingError('invalid control path/kind: '+path)
                fields = node.get('fields' if kind == 'setpoint' else 'args', {})
                if set(mapping.get('fields', {})) != set(fields):
                    raise MappingError('exact control fields required: '+path)

    def reset(self, epoch):
        if not isinstance(epoch, str) or not epoch:
            raise MappingError('source epoch required')
        self.epoch = epoch
        self.observations.clear()
        self.last_sent.clear()
        self.last_capture.clear()
        self.errors.clear()

    def receive(self, topic, message, *, source_time_ns, source_epoch, source_clock='ROS_TIME', now_ns=None):
        if source_epoch != self.epoch:
            raise MappingError('source epoch changed; explicit reset/session restart required')
        if type(source_time_ns) is not int or source_time_ns < 0 or source_clock != 'ROS_TIME':
            raise MappingError('invalid ROS capture metadata')
        if topic not in self.topics:
            raise MappingError('unmapped topic')
        if source_time_ns <= self.last_capture.get(topic, -1):
            return []  # repeated/frozen/out-of-order captures cannot renew freshness
        self.last_capture[topic] = source_time_ns
        now_ns = time.monotonic_ns() if now_ns is None else now_ns
        updated = []
        for path, mapping in self.topics[topic]:
            try:
                if mapping['type'] == 'sensor_msgs/msg/Imu':
                    component = mapping['field'].split('.')[0]
                    if component in ('orientation', 'angular_velocity', 'linear_acceleration'):
                        covariance = sequence(field(message, component+'_covariance'))
                        if len(covariance) != 9 or number(covariance[0]) < 0:
                            raise MappingError('IMU component unavailable')
                value = field(message, mapping['field'])
                for operation in mapping.get('transforms', []):
                    value = transform(value, operation, message)
                node = self.catalog['nodes'][path]
                value = scalar_from_wire(scalar_value(value, node), node)
                quality = pb.OK
                self.errors.pop(path, None)
            except (ValueError, TypeError, KeyError, IndexError, OverflowError) as error:
                value, quality = None, pb.NONE
                self.errors[path] = str(error)[:200]
            previous = self.observations.get(path)
            if (previous and previous.quality == quality
                    and now_ns-self.last_sent[path] < 1e9/mapping['maxRateHz']):
                continue
            self.observations[path] = Observation(value, quality, source_time_ns, source_epoch, source_clock)
            self.last_sent[path] = now_ns
            updated.append(path)
        return updated

    def values(self):
        return {path: item.value for path, item in self.observations.items()}

    def quality(self, path):
        item = self.observations.get(path)
        return item.quality if item else pb.NONE

    def sample_metadata(self, path):
        item = self.observations.get(path)
        return dict(source_time_ns=item.source_time_ns, source_clock=item.source_clock,
                    source_epoch=item.source_epoch) if item else {}

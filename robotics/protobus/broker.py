"""Protobus data plane. Control methods are added only after their safety gates.

All state is owned by one asyncio loop. ROS time never drives broker watchdogs.
"""
import argparse
import asyncio
from collections import deque
from dataclasses import dataclass, field
import hashlib
import json
import math
from pathlib import Path
import time
import uuid
from google.protobuf.json_format import MessageToDict

import grpc
from jsonschema import Draft202012Validator
from commands import CommandPlane
from targets import TargetError
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc

PROTOCOL_VERSION = '1.6'
CONNECTION_PATHS = {
    'Robot.Connection.IsOnline', 'Robot.Connection.IsHandshakeComplete',
    'Robot.Connection.LastSampleAgeMs',
}


class BusError(ValueError):
    def __init__(self, code, detail=''):
        self.code, self.detail = code, detail
        super().__init__(code + (': ' + detail if detail else ''))


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=False, allow_nan=False).encode()


def clone(message):
    result = type(message)()
    result.CopyFrom(message)
    return result


def load_catalog(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise BusError('PB_INVALID_VALUE', 'duplicate catalog key')
            result[key] = value
        return result
    catalog = json.loads(Path(path).read_text(), object_pairs_hook=unique)
    schema = json.loads(Path('/contracts/rss-catalog.v1.json').read_text())
    Draft202012Validator(schema).validate(catalog)
    content = dict(catalog)
    actual = content.pop('catalogHash')
    if actual != 'sha256:' + hashlib.sha256(canonical(content)).hexdigest():
        raise BusError('PB_CATALOG_MISMATCH', 'catalog content hash')
    return catalog


def validate_value(value, node, path):
    expected = {'bool': 'bool_value', 'int32': 'int32_value', 'int64': 'int64_value',
                'uint8': 'uint32_value', 'uint32': 'uint32_value',
                'float32': 'float32_value', 'float64': 'float64_value',
                'string': 'string_value', 'enum': 'string_value'}[node['type']]
    if value.WhichOneof('kind') != expected:
        raise BusError('PB_INVALID_VALUE', path + ': exact wire type required')
    scalar = getattr(value, expected)
    if node['type'] in ('float32', 'float64') and not math.isfinite(scalar):
        raise BusError('PB_INVALID_VALUE', path + ': nonfinite value')
    if node['type'] == 'uint8' and scalar > 255:
        raise BusError('PB_INVALID_VALUE', path + ': uint8 overflow')
    if node['type'] in ('string', 'enum') and len(scalar.encode()) > 4096:
        raise BusError('PB_INVALID_VALUE', path + ': string too long')
    if ('min' in node and scalar < node['min']) or ('max' in node and scalar > node['max']):
        raise BusError('PB_INVALID_VALUE', path + ': bounds')
    if node['type'] == 'enum' and scalar not in node['values']:
        raise BusError('PB_INVALID_VALUE', path + ': enum')


def encode_value(scalar, node):
    kind = {'bool': 'bool_value', 'int32': 'int32_value', 'int64': 'int64_value',
            'uint8': 'uint32_value', 'uint32': 'uint32_value', 'float32': 'float32_value',
            'float64': 'float64_value', 'string': 'string_value', 'enum': 'string_value'}[node['type']]
    if type(scalar) is bool and node['type'] != 'bool':
        raise BusError('PB_INVALID_VALUE', 'bool is not a numeric safeValue')
    try:
        value = pb.Value(**{kind: scalar})
    except (TypeError, ValueError, OverflowError) as error:
        raise BusError('PB_INVALID_VALUE', 'invalid typed safeValue') from error
    validate_value(value, node, 'catalog safeValue')
    return value


def safe_object(node):
    if set(node['safeValue']) != set(node['fields']):
        raise BusError('PB_INVALID_VALUE', 'safeValue must include every field exactly')
    return pb.Object(fields={name: encode_value(node['safeValue'][name], spec)
                             for name, spec in node['fields'].items()})


@dataclass
class Record:
    sample: pb.Sample
    received_ns: int


@dataclass(eq=False)
class Subscriber:
    paths: set
    interval: float
    values: dict = field(default_factory=dict)
    qualities: deque = field(default_factory=deque)
    event: asyncio.Event = field(default_factory=asyncio.Event)
    failure: str = ''

    def notify(self, sample, quality_changed):
        if sample.path not in self.paths or self.failure:
            return
        if quality_changed:
            if len(self.qualities) >= 512:
                self.failure = 'PB_QUEUE_FULL'
            else:
                self.qualities.append(clone(sample))
        else:
            self.values[sample.path] = clone(sample)
        self.event.set()


@dataclass
class ProviderState:
    hello: pb.ProviderHello
    last_seen_ns: int
    attach_peer: str = ''
    control_peer: str = ''
    safety_peer: str = ''
    last_sample_ns: int = 0
    control_ready: bool = False
    safety_ready: bool = False
    control_queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=128))
    safety_queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=16))


@dataclass
class LeaseState:
    token: str
    fence: int
    client_id: str
    ttl_ns: int
    deadline_ns: int
    last_sequence: int = 0


@dataclass
class ActiveTarget:
    path: str
    owner_id: str
    fence: int
    sequence: int
    deadline_ns: int


class Broker(CommandPlane, rpc.BusServicer, rpc.ProviderServicer):
    error_type = BusError
    validate_wire_value = staticmethod(validate_value)

    def __init__(self, catalog, robot_id='dog1', profile_id='dog-go2-sim',
                 host_clock_id=None, provider_timeout_ms=1000, audit_path=None, stop_wait_ms=200):
        self.catalog = catalog
        self.nodes = catalog['nodes']
        self.catalog_hash = catalog['catalogHash']
        self.robot_id, self.profile_id = robot_id, profile_id
        self.host_clock_id = host_clock_id or Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        self.epoch = str(uuid.uuid4())
        self.provider_timeout_ns = provider_timeout_ms * 1_000_000
        self.provider = None
        self.lease = None
        self.fence = 0
        self.targets = {}
        setpoints = [n for n in self.nodes.values() if n['kind'] == 'setpoint']
        if len(setpoints) > 8:
            raise BusError('PB_INVALID_VALUE', 'v1.2 supports at most eight setpoint nodes')
        for path, node in self.nodes.items():
            if node['kind'] == 'setpoint':
                safe_object(node)
                if 1000 / node['refreshHz'] >= node['ttlMs']:
                    raise BusError('PB_INVALID_VALUE', 'refresh period must be shorter than TTL')
                if path == 'Robot.Motion.Velocity' and any(value != 0 for value in node['safeValue'].values()):
                    raise BusError('PB_INVALID_VALUE', 'velocity safeValue must be zero')
        self.subscribers = set()
        self.internal_sequence = 0
        self.records = {
            path: Record(pb.Sample(path=path, quality=pb.NONE, source_epoch=self.epoch), 0)
            for path, node in self.nodes.items() if node['kind'] in ('sensor', 'attribute')
        }
        self.sweeper = None
        self.update_connection()
        self.init_commands(audit_path, stop_wait_ms)

    async def start(self):
        await self.audit.start()
        if self.sweeper is None:
            self.sweeper = asyncio.create_task(self.sweep())

    async def close(self):
        self.revoke_lease('BROKER_SHUTDOWN')
        if self.sweeper is not None:
            self.sweeper.cancel()
            await asyncio.gather(self.sweeper, return_exceptions=True)
            self.sweeper = None
        await self.audit.close()

    def publish_record(self, sample, received_ns):
        previous = self.records[sample.path].sample
        changed_quality = previous.quality != sample.quality
        changed_value = previous.value != sample.value
        self.records[sample.path] = Record(clone(sample), received_ns)
        if changed_quality or changed_value:
            for subscriber in tuple(self.subscribers):
                subscriber.notify(sample, changed_quality)

    def update_connection(self):
        now = time.monotonic_ns()
        provider = self.provider
        online = provider is not None and now - provider.last_seen_ns < self.provider_timeout_ns
        ready = online and provider.control_ready and provider.safety_ready
        values = {
            'Robot.Connection.IsOnline': pb.Value(bool_value=online),
            'Robot.Connection.IsHandshakeComplete': pb.Value(bool_value=bool(ready)),
            'Robot.Connection.LastSampleAgeMs': (pb.Value(float64_value=(now-provider.last_sample_ns)/1e6)
                                               if provider and provider.last_sample_ns else None),
        }
        for path, value in values.items():
            if path not in self.records:
                continue
            self.internal_sequence += 1
            sample = pb.Sample(path=path, quality=pb.OK if value else pb.NONE,
                               source_time_ns=now, broker_time_ns=now,
                               sequence=self.internal_sequence, source_clock='MONOTONIC', source_epoch=self.epoch)
            if value is not None:
                sample.value.CopyFrom(value)
            self.publish_record(sample, now)

    async def provider_lost(self, provider):
        if self.provider is not provider:
            return
        self.revoke_lease('PROVIDER_LOST')
        self.provider = None
        now = time.monotonic_ns()
        for path, record in list(self.records.items()):
            if path in CONNECTION_PATHS or self.nodes[path].get('generated') or record.sample.quality != pb.OK:
                continue
            sample = clone(record.sample)
            sample.quality = pb.STALE
            sample.broker_time_ns = now
            self.publish_record(sample, record.received_ns)
        self.update_connection()

    async def sweep_once(self):
        now = time.monotonic_ns()
        if self.provider and now - self.provider.last_seen_ns >= self.provider_timeout_ns:
            await self.provider_lost(self.provider)
        self.expire_control(now)
        self.expire_commands(now)
        if any(record.release_requested for record in self.holds.expire(now)):
            self.request_stop('TARGET_RELEASE_TIMEOUT')
        for path, record in list(self.records.items()):
            age_ms = self.nodes[path].get('maxAgeMs')
            if (path not in CONNECTION_PATHS and not self.nodes[path].get('generated')
                    and age_ms and record.sample.quality == pb.OK
                    and now - record.received_ns >= age_ms * 1_000_000):
                sample = clone(record.sample)
                sample.quality = pb.STALE
                sample.broker_time_ns = now
                self.publish_record(sample, record.received_ns)
        self.update_connection()

    async def sweep(self):
        while True:
            await self.sweep_once()
            await asyncio.sleep(.02)

    def query_paths(self, query):
        if query.catalog_hash != self.catalog_hash:
            raise BusError('PB_CATALOG_MISMATCH')
        if len(query.paths) > 512 or query.min_interval_ms > 60000:
            raise BusError('PB_INVALID_VALUE', 'query limits')
        paths = sorted(set(query.paths)) if query.paths else sorted(self.records)
        for path in paths:
            if path not in self.nodes:
                raise BusError('PB_INVALID_PATH', path)
            if path not in self.records:
                raise BusError('PB_INVALID_KIND', path)
        return paths

    async def abort(self, context, error):
        self.audit_event('rpc_rejected', client_id=context.peer(), reason=error.code)
        status = grpc.StatusCode.INVALID_ARGUMENT
        if error.code in ('PB_CATALOG_MISMATCH', 'PB_PROVIDER_MISMATCH', 'PB_CLOCK_MISMATCH',
                          'PB_PROVIDER_OFFLINE', 'PB_BACKEND_FORBIDDEN', 'PB_RESOURCE_BUSY',
                          'PB_LEASE_REQUIRED', 'PB_LEASE_BUSY', 'PB_LEASE_EXPIRED',
                          'PB_AUDIT_FAILED', 'PB_STOPPED'):
            status = grpc.StatusCode.FAILED_PRECONDITION
        await context.abort(status, str(error))

    def require_provider(self):
        if self.audit.failed:
            raise BusError('PB_AUDIT_FAILED')
        provider = self.provider
        if (provider is None or not provider.control_ready or not provider.safety_ready
                or time.monotonic_ns() - provider.last_seen_ns >= self.provider_timeout_ns):
            raise BusError('PB_PROVIDER_OFFLINE', 'fresh data and independent control/safety lanes required')
        return provider

    def lease_message(self):
        lease = self.lease
        return pb.Lease(token=lease.token, fence=lease.fence, broker_epoch=self.epoch,
                        remaining_ms=max(0, (lease.deadline_ns-time.monotonic_ns()+999999)//1000000),
                        client_id=lease.client_id)

    def require_lease(self, request):
        self.expire_control(time.monotonic_ns())
        lease = self.lease
        if not request.token:
            raise BusError('PB_LEASE_REQUIRED')
        if (lease is None or request.token != lease.token or request.fence != lease.fence
                or request.broker_epoch != self.epoch or request.client_id != lease.client_id):
            raise BusError('PB_LEASE_EXPIRED')
        self.require_provider()
        return lease

    def emit_safety(self, message):
        provider = self.provider
        if provider is None:
            return
        queue = provider.safety_queue
        retained = []
        while not queue.empty():
            old = queue.get_nowait()
            if old.kind == pb.STOP and message.kind != pb.STOP:
                retained.append(old)
            elif message.kind != pb.STOP and old.path != message.path:
                retained.append(old)
        # At most eight distinct setpoints plus a STOP can be pending.
        for old in retained:
            queue.put_nowait(old)
        queue.put_nowait(message)

    def safe_target(self, target, reason, operation_id=''):
        provider = self.provider
        self.emit_safety(pb.Dispatch(kind=pb.SAFE_VALUE, path=target.path,
                         value=safe_object(self.nodes[target.path]), fence=target.fence,
                         sequence=target.sequence, broker_epoch=self.epoch,
                         provider_session=provider.hello.session if provider else '',
                         owner_id=target.owner_id, reason=reason,execution_id=operation_id))

    def revoke_lease(self, reason):
        lease = self.lease
        if lease is None:
            return
        self.lease = None
        self.holds.revoke(lease.fence)
        self.fence += 1
        self.cancel_lease_commands(lease.fence, reason)
        self.invocation_keys = {key: value for key, value in self.invocation_keys.items() if key[0] != lease.fence}
        self.audit_event('lease_revoked', client_id=lease.client_id, fence=lease.fence, reason=reason)
        provider = self.provider
        if provider:
            retained = []
            while not provider.control_queue.empty():
                item = provider.control_queue.get_nowait()
                if item.fence != lease.fence:
                    retained.append(item)
            for item in retained:
                provider.control_queue.put_nowait(item)
        targets = list(self.targets.values())
        self.targets.clear()
        for target in targets:
            self.safe_target(target, reason)
        if provider:
            self.emit_safety(pb.Dispatch(kind=pb.LEASE_REVOKED, fence=lease.fence,
                             broker_epoch=self.epoch, provider_session=provider.hello.session,
                             reason=reason))

    def expire_control(self, now):
        if self.lease and now >= self.lease.deadline_ns:
            self.revoke_lease('LEASE_EXPIRED')
        for path, target in list(self.targets.items()):
            if now >= target.deadline_ns:
                self.targets.pop(path)
                self.safe_target(target, 'TARGET_EXPIRED')

    async def AcquireLease(self, request, context):
        try:
            if request.catalog_hash != self.catalog_hash:
                raise BusError('PB_CATALOG_MISMATCH')
            self.expire_control(time.monotonic_ns())
            provider = self.require_provider()
            if self.lease is not None:
                raise BusError('PB_LEASE_BUSY')
            ttl_ms = request.ttl_ms or 1000
            if not 100 <= ttl_ms <= 5000 or not 1 <= len(request.client_id) <= 128:
                raise BusError('PB_INVALID_VALUE', 'lease duration/client limits')
            if provider.control_queue.full():
                raise BusError('PB_QUEUE_FULL')
            self.fence += 1
            self.lease = LeaseState(str(uuid.uuid4()), self.fence, request.client_id,
                                    ttl_ms*1_000_000, time.monotonic_ns()+ttl_ms*1_000_000)
            self.queue_lease_update(provider)
            if not self.audit_event('lease_acquired', client_id=request.client_id, fence=self.lease.fence, ttl_ms=ttl_ms):
                raise BusError('PB_AUDIT_FAILED')
            return self.lease_message()
        except BusError as error:
            await self.abort(context, error)

    async def RenewLease(self, request, context):
        try:
            lease = self.require_lease(request)
            provider = self.require_provider()
            if provider.control_queue.full():
                raise BusError('PB_QUEUE_FULL')
            lease.deadline_ns = time.monotonic_ns() + lease.ttl_ns
            self.queue_lease_update(provider)
            if not self.audit_event('lease_renewed', client_id=lease.client_id, fence=lease.fence):
                raise BusError('PB_AUDIT_FAILED')
            return self.lease_message()
        except BusError as error:
            await self.abort(context, error)

    async def ReleaseLease(self, request, context):
        try:
            self.require_lease(request)
            self.revoke_lease('LEASE_RELEASED')
            return pb.Reply(ok=True)
        except BusError as error:
            await self.abort(context, error)

    def queue_lease_update(self, provider):
        lease = self.lease
        provider.control_queue.put_nowait(pb.Dispatch(kind=pb.LEASE_UPDATE,
            fence=lease.fence, broker_epoch=self.epoch, provider_session=provider.hello.session,
            deadline_monotonic_ns=lease.deadline_ns,
            valid_for_ms=max(0, (lease.deadline_ns-time.monotonic_ns())//1_000_000)))

    async def SetTarget(self, request, context):
        try:
            lease = self.require_lease(request.lease)
            if self.stop_latched:
                raise BusError('PB_STOPPED')
            if self.active_execution or self.draining:
                raise BusError('PB_RESOURCE_BUSY', 'body/navigation awaits command completion')
            node = self.nodes.get(request.path)
            if node is None:
                raise BusError('PB_INVALID_PATH', request.path)
            if node['kind'] != 'setpoint':
                raise BusError('PB_INVALID_KIND', request.path)
            if request.sequence <= lease.last_sequence:
                raise BusError('PB_REPLAY')
            if not 1 <= len(request.owner_id) <= 128:
                raise BusError('PB_INVALID_VALUE', 'Hold owner ID required')
            if set(request.value.fields) != set(node['fields']):
                raise BusError('PB_INVALID_VALUE', 'atomic setpoint requires complete exact struct')
            for name, spec in node['fields'].items():
                validate_value(request.value.fields[name], spec, request.path+'.'+name)
            active = self.targets.get(request.path)
            if active and active.owner_id != request.owner_id:
                raise BusError('PB_RESOURCE_BUSY', 'another Hold owns this setpoint')
            if request.release and request.value != safe_object(node):
                raise BusError('PB_INVALID_VALUE', 'release must carry catalog safeValue')
            provider = self.require_provider()
            deadline = min(lease.deadline_ns, time.monotonic_ns()+node['ttlMs']*1_000_000)
            if request.path not in provider.hello.claims:
                raise BusError('PB_PROVIDER_MISMATCH', 'provider does not claim this setpoint')
            key=(provider.hello.session,lease.fence,request.path,request.owner_id)
            if any(not old.resource_released and self.holds.key(old)!=key for old in self.holds.records.values()):
                raise BusError('PB_RESOURCE_BUSY','another Hold awaits physical release')
            if not request.release and provider.control_queue.full():raise BusError('PB_QUEUE_FULL')
            try:
                record,dispatch_needed=self.holds.stage(request.path,request.owner_id,lease.fence,
                    provider.hello.session,request.sequence,
                    time.monotonic_ns()+3_000_000_000 if request.release else deadline,request.release)
            except TargetError as error:raise BusError('PB_REPLAY',str(error)) from error
            target = ActiveTarget(request.path, request.owner_id, lease.fence, request.sequence, deadline)
            if request.release:
                self.targets.pop(request.path, None)
                if dispatch_needed:self.safe_target(target, 'TARGET_RELEASED',record.id)
            else:
                dispatch = pb.Dispatch(kind=pb.SET_TARGET, path=request.path, value=request.value,
                                      fence=lease.fence, sequence=request.sequence, broker_epoch=self.epoch,
                                      provider_session=provider.hello.session, owner_id=request.owner_id,
                                      valid_for_ms=max(0, (deadline-time.monotonic_ns())//1_000_000),
                                      deadline_monotonic_ns=deadline)
                dispatch.execution_id=record.id
                if provider.control_queue.full():
                    raise BusError('PB_QUEUE_FULL')
                provider.control_queue.put_nowait(dispatch)
                self.targets[request.path] = target
            lease.last_sequence = request.sequence
            audit_ok = self.audit_event('target_released' if request.release else 'target_set',
                             client_id=lease.client_id, path=request.path, fence=lease.fence,
                             sequence=str(request.sequence), owner_id=request.owner_id,
                             value=MessageToDict(request.value))
            if not audit_ok:
                raise BusError('PB_AUDIT_FAILED')
            return pb.Reply(ok=True,operation_id=record.id)
        except BusError as error:
            await self.abort(context, error)

    async def Describe(self, request, context):
        return pb.Descriptor(robot_id=self.robot_id, profile_id=self.profile_id,
                             catalog_hash=self.catalog_hash, broker_epoch=self.epoch,
                             provider_online=self.provider is not None, backend='SIM',
                             host_clock_id=self.host_clock_id, protocol_version=PROTOCOL_VERSION,
                             audit_ok=not self.audit.failed,
                             provider_session=self.provider.hello.session if self.provider else '',
                             target_context=self.provider.hello.target_context if self.provider else None)

    async def Get(self, request, context):
        try:
            paths = self.query_paths(request)
        except BusError as error:
            await self.abort(context, error)
        await self.sweep_once()
        return pb.Samples(samples=[clone(self.records[path].sample) for path in paths], broker_epoch=self.epoch,
            provider_session=self.provider.hello.session if self.provider else '')

    async def Subscribe(self, request, context):
        try:
            paths = self.query_paths(request)
        except BusError as error:
            await self.abort(context, error)
        if len(self.subscribers) >= 32:
            await context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, 'PB_QUEUE_FULL: subscriber limit')
        subscriber = Subscriber(set(paths), request.min_interval_ms / 1000)
        self.subscribers.add(subscriber)
        last_sent = time.monotonic()
        try:
            yield pb.Samples(samples=[clone(self.records[path].sample) for path in paths], broker_epoch=self.epoch,
                provider_session=self.provider.hello.session if self.provider else '')
            while True:
                await subscriber.event.wait()
                subscriber.event.clear()
                if subscriber.failure:
                    await context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, subscriber.failure)
                if not subscriber.qualities:
                    remaining = subscriber.interval - (time.monotonic() - last_sent)
                    if remaining > 0:
                        try:
                            await asyncio.wait_for(subscriber.event.wait(), remaining)
                            continue
                        except asyncio.TimeoutError:
                            pass
                changed = list(subscriber.qualities)
                subscriber.qualities.clear()
                changed.extend(subscriber.values[path] for path in sorted(subscriber.values))
                subscriber.values.clear()
                if changed:
                    last_sent = time.monotonic()
                    yield pb.Samples(samples=changed, broker_epoch=self.epoch,
                        provider_session=self.provider.hello.session if self.provider else '')
        finally:
            self.subscribers.discard(subscriber)

    def check_hello(self, hello):
        from identity import validate_context
        try:validate_context(hello.target_context)
        except ValueError as error:raise BusError('PB_PROVIDER_MISMATCH',str(error)) from error
        if hello.catalog_hash != self.catalog_hash:
            raise BusError('PB_CATALOG_MISMATCH')
        if hello.backend != 'SIM':
            raise BusError('PB_BACKEND_FORBIDDEN')
        if hello.host_clock_id != self.host_clock_id:
            raise BusError('PB_CLOCK_MISMATCH')
        if (hello.profile_id != self.profile_id or hello.protocol_version != PROTOCOL_VERSION
                or not hello.provider_id or not hello.session or len(hello.session) > 128):
            raise BusError('PB_PROVIDER_MISMATCH')
        if not hello.claims or len(hello.claims) != len(set(hello.claims)):
            raise BusError('PB_PROVIDER_MISMATCH', 'explicit unique claims required')
        for path in hello.claims:
            if path not in self.nodes or path in CONNECTION_PATHS or self.nodes[path].get('generated'):
                raise BusError('PB_PROVIDER_MISMATCH', 'invalid claim: ' + path)

    def ingest(self, batch, provider):
        if self.provider is not provider or batch.provider_session != provider.hello.session:
            raise BusError('PB_PROVIDER_MISMATCH')
        if not 1 <= len(batch.samples) <= 256:
            raise BusError('PB_INVALID_VALUE', 'sample batch limits')
        now = time.monotonic_ns()
        staged, seen = [], set()
        for incoming in batch.samples:
            path = incoming.path
            if path in seen:
                raise BusError('PB_INVALID_VALUE', 'duplicate path in batch')
            seen.add(path)
            if path not in self.nodes:
                raise BusError('PB_INVALID_PATH', path)
            node = self.nodes[path]
            if node['kind'] not in ('sensor', 'attribute'):
                raise BusError('PB_INVALID_KIND', path)
            if path not in provider.hello.claims or path in CONNECTION_PATHS or node.get('generated'):
                raise BusError('PB_PROVIDER_MISMATCH', path)
            if incoming.quality not in (pb.OK, pb.STALE, pb.NONE):
                raise BusError('PB_INVALID_VALUE', 'quality')
            if incoming.quality != pb.NONE:
                validate_value(incoming.value, node, path)
            elif incoming.value.WhichOneof('kind') is not None:
                raise BusError('PB_INVALID_VALUE', 'NONE sample cannot carry an invented value')
            if (incoming.source_clock not in ('ROS_TIME', 'MONOTONIC', 'STATIC')
                    or not 1 <= len(incoming.source_epoch) <= 128
                    or incoming.source_time_ns < 0 or incoming.sequence == 0):
                raise BusError('PB_INVALID_VALUE', 'sample time/epoch/sequence')
            old = self.records[path]
            if old.received_ns:
                if incoming.source_clock != old.sample.source_clock:
                    raise BusError('PB_PROVIDER_MISMATCH', 'source clock changed within session')
                if incoming.source_epoch != old.sample.source_epoch:
                    raise BusError('PB_PROVIDER_MISMATCH', 'new source epoch requires provider reattachment')
                if incoming.sequence <= old.sample.sequence or incoming.source_time_ns < old.sample.source_time_ns:
                    raise BusError('PB_REPLAY', path)
                if (incoming.source_time_ns == old.sample.source_time_ns
                        and incoming.value != old.sample.value and incoming.source_clock != 'STATIC'):
                    raise BusError('PB_REPLAY', 'value changed without a new capture')
            received = now
            if (old.received_ns and incoming.source_time_ns == old.sample.source_time_ns
                    and incoming.source_clock != 'STATIC'):
                received = old.received_ns
            sample = clone(incoming)
            sample.broker_time_ns = now
            if (node.get('maxAgeMs') and sample.quality == pb.OK
                    and now - received >= node['maxAgeMs'] * 1_000_000):
                sample.quality = pb.STALE
            staged.append((sample, received))
        for sample, received in staged:
            self.publish_record(sample, received)
        provider.last_seen_ns = now
        provider.last_sample_ns = now
        self.update_connection()

    async def Attach(self, requests, context):
        provider = None
        try:
            async for packet in requests:
                kind = packet.WhichOneof('packet')
                if provider is None:
                    try:
                        if kind != 'hello':
                            raise BusError('PB_PROVIDER_MISMATCH', 'hello must be first')
                        self.check_hello(packet.hello)
                        if self.provider is not None:
                            raise BusError('PB_RESOURCE_BUSY', 'provider already attached')
                    except BusError as error:
                        await self.abort(context, error)
                    # A new session cannot inherit old sequence/quality history.
                    for path, record in self.records.items():
                        if path not in CONNECTION_PATHS and not self.nodes[path].get('generated'):
                            record.received_ns = 0
                    provider = ProviderState(clone(packet.hello), time.monotonic_ns(), attach_peer=context.peer())
                    self.provider = provider
                    self.update_connection()
                    yield pb.Reply(ok=True)
                    continue
                if self.provider is not provider:
                    await self.abort(context, BusError('PB_PROVIDER_OFFLINE'))
                try:
                    if kind == 'samples':
                        self.ingest(packet.samples, provider)
                    elif kind == 'command':
                        self.process_command_update(packet.command, provider)
                        provider.last_seen_ns = time.monotonic_ns()
                    elif kind == 'heartbeat_session' and packet.heartbeat_session == provider.hello.session:
                        provider.last_seen_ns = time.monotonic_ns()
                    else:
                        raise BusError('PB_PROVIDER_MISMATCH', 'unexpected provider packet')
                    yield pb.Reply(ok=True)
                except BusError as error:
                    yield pb.Reply(ok=False, code=error.code, detail=error.detail)
            if provider is None:
                await self.abort(context, BusError('PB_PROVIDER_MISMATCH', 'missing hello'))
        finally:
            if provider is not None:
                await self.provider_lost(provider)

    async def provider_lane(self, hello, context, safety):
        try:
            self.check_hello(hello)
            provider = self.provider
            if provider is None or provider.hello != hello:
                raise BusError('PB_PROVIDER_MISMATCH', 'attach data session first')
            flag = 'safety_ready' if safety else 'control_ready'
            if getattr(provider, flag):
                raise BusError('PB_RESOURCE_BUSY', 'lane already attached')
            peer = context.peer()
            if safety and peer in (provider.attach_peer, provider.control_peer):
                raise BusError('PB_PROVIDER_MISMATCH', 'Safety requires an independent TCP connection')
            if not safety and provider.safety_peer == peer:
                raise BusError('PB_PROVIDER_MISMATCH', 'Control cannot share Safety TCP connection')
        except BusError as error:
            await self.abort(context, error)
        setattr(provider, flag, True)
        peer_field = 'safety_peer' if safety else 'control_peer'
        setattr(provider, peer_field, peer)
        self.update_connection()
        await context.send_initial_metadata(())
        queue = provider.safety_queue if safety else provider.control_queue
        try:
            while self.provider is provider or (safety and not queue.empty()):
                try:
                    message = await asyncio.wait_for(queue.get(), .1)
                    yield message
                except asyncio.TimeoutError:
                    continue
            await self.abort(context, BusError('PB_PROVIDER_OFFLINE'))
        finally:
            setattr(provider, flag, False)
            setattr(provider, peer_field, '')
            if self.provider is provider:
                self.revoke_lease('SAFETY_LANE_LOST' if safety else 'CONTROL_LANE_LOST')
            self.update_connection()

    async def Control(self, request, context):
        async for message in self.provider_lane(request, context, False):
            yield message

    async def Safety(self, request, context):
        async for message in self.provider_lane(request, context, True):
            yield message


async def serve(args):
    broker = Broker(load_catalog(args.catalog), robot_id=args.robot, profile_id=args.profile, audit_path=args.audit)
    server = grpc.aio.server(options=[('grpc.max_receive_message_length', 1024*1024),
                                      ('grpc.max_send_message_length', 1024*1024)])
    rpc.add_BusServicer_to_server(broker, server)
    rpc.add_ProviderServicer_to_server(broker, server)
    if server.add_insecure_port(args.listen) == 0:
        raise RuntimeError('Cannot bind broker listener')
    await broker.start()
    await server.start()
    try:
        await server.wait_for_termination()
    finally:
        await broker.close()
        await server.stop(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--catalog', required=True)
    parser.add_argument('--listen', default='0.0.0.0:55600')
    parser.add_argument('--robot', default='dog1')
    parser.add_argument('--profile', default='dog-go2-sim')
    parser.add_argument('--audit', default='/data/protobus-audit.jsonl')
    asyncio.run(serve(parser.parse_args()))


if __name__ == '__main__':
    main()

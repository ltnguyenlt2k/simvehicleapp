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

import grpc
from jsonschema import Draft202012Validator
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc

PROTOCOL_VERSION = '1.1'
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
    safety_queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=8))


class Broker(rpc.BusServicer, rpc.ProviderServicer):
    def __init__(self, catalog, robot_id='dog1', profile_id='dog-go2-sim',
                 host_clock_id=None, provider_timeout_ms=1000):
        self.catalog = catalog
        self.nodes = catalog['nodes']
        self.catalog_hash = catalog['catalogHash']
        self.robot_id, self.profile_id = robot_id, profile_id
        self.host_clock_id = host_clock_id or Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        self.epoch = str(uuid.uuid4())
        self.provider_timeout_ns = provider_timeout_ms * 1_000_000
        self.provider = None
        self.subscribers = set()
        self.internal_sequence = 0
        self.records = {
            path: Record(pb.Sample(path=path, quality=pb.NONE, source_epoch=self.epoch), 0)
            for path, node in self.nodes.items() if node['kind'] in ('sensor', 'attribute')
        }
        self.sweeper = None
        self.update_connection()

    async def start(self):
        if self.sweeper is None:
            self.sweeper = asyncio.create_task(self.sweep())

    async def close(self):
        if self.sweeper is not None:
            self.sweeper.cancel()
            await asyncio.gather(self.sweeper, return_exceptions=True)
            self.sweeper = None

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
        self.provider = None
        now = time.monotonic_ns()
        for path, record in list(self.records.items()):
            if path in CONNECTION_PATHS or record.sample.quality != pb.OK:
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
        for path, record in list(self.records.items()):
            age_ms = self.nodes[path].get('maxAgeMs')
            if (path not in CONNECTION_PATHS and age_ms and record.sample.quality == pb.OK
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
        status = grpc.StatusCode.INVALID_ARGUMENT
        if error.code in ('PB_CATALOG_MISMATCH', 'PB_PROVIDER_MISMATCH', 'PB_CLOCK_MISMATCH',
                          'PB_PROVIDER_OFFLINE', 'PB_BACKEND_FORBIDDEN', 'PB_RESOURCE_BUSY'):
            status = grpc.StatusCode.FAILED_PRECONDITION
        await context.abort(status, str(error))

    async def Describe(self, request, context):
        return pb.Descriptor(robot_id=self.robot_id, profile_id=self.profile_id,
                             catalog_hash=self.catalog_hash, broker_epoch=self.epoch,
                             provider_online=self.provider is not None, backend='SIM',
                             host_clock_id=self.host_clock_id, protocol_version=PROTOCOL_VERSION)

    async def Get(self, request, context):
        try:
            paths = self.query_paths(request)
        except BusError as error:
            await self.abort(context, error)
        await self.sweep_once()
        return pb.Samples(samples=[clone(self.records[path].sample) for path in paths], broker_epoch=self.epoch)

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
            yield pb.Samples(samples=[clone(self.records[path].sample) for path in paths], broker_epoch=self.epoch)
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
                    yield pb.Samples(samples=changed, broker_epoch=self.epoch)
        finally:
            self.subscribers.discard(subscriber)

    def check_hello(self, hello):
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
                        if path not in CONNECTION_PATHS:
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
            while self.provider is provider:
                try:
                    message = await asyncio.wait_for(queue.get(), .1)
                    yield message
                except asyncio.TimeoutError:
                    continue
            await self.abort(context, BusError('PB_PROVIDER_OFFLINE'))
        finally:
            setattr(provider, flag, False)
            setattr(provider, peer_field, '')
            self.update_connection()

    async def Control(self, request, context):
        async for message in self.provider_lane(request, context, False):
            yield message

    async def Safety(self, request, context):
        async for message in self.provider_lane(request, context, True):
            yield message


async def serve(args):
    broker = Broker(load_catalog(args.catalog), robot_id=args.robot, profile_id=args.profile)
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
        await server.stop(1)
        await broker.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--catalog', required=True)
    parser.add_argument('--listen', default='0.0.0.0:55600')
    parser.add_argument('--robot', default='dog1')
    parser.add_argument('--profile', default='dog-go2-sim')
    asyncio.run(serve(parser.parse_args()))


if __name__ == '__main__':
    main()

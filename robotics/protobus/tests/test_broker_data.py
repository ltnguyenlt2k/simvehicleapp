"""M23 data contract tests use actual grpc.aio sockets, not HTTP response mocks."""
import asyncio
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
import uuid

import grpc
from broker import Broker, BusError, PROTOCOL_VERSION, Subscriber, canonical, load_catalog
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc


def catalog_fixture():
    nodes = {
        'Robot.Signal.Speed': {'kind': 'sensor', 'type': 'float64', 'min': 0, 'max': 1, 'maxAgeMs': 80},
        'Robot.Signal.Flag': {'kind': 'sensor', 'type': 'bool', 'maxAgeMs': 300},
        'Robot.Signal.Mode': {'kind': 'sensor', 'type': 'enum', 'values': ['IDLE', 'RUNNING'], 'maxAgeMs': 300},
        'Robot.Signal.Byte': {'kind': 'sensor', 'type': 'uint8', 'maxAgeMs': 300},
        'Robot.Identity.Model': {'kind': 'attribute', 'type': 'string'},
        'Robot.Connection.IsOnline': {'kind': 'sensor', 'type': 'bool', 'maxAgeMs': 100},
        'Robot.Connection.IsHandshakeComplete': {'kind': 'sensor', 'type': 'bool', 'maxAgeMs': 100},
        'Robot.Connection.LastSampleAgeMs': {'kind': 'sensor', 'type': 'float64', 'unit': 'ms', 'maxAgeMs': 100},
        'Robot.Motion.Velocity': {
            'kind': 'setpoint', 'fields': {'LinearX': {'type': 'float64', 'min': -.5, 'max': .5}},
            'ttlMs': 300, 'refreshHz': 20, 'safeValue': {'LinearX': 0}},
        'Robot.Motion.Perform': {'kind': 'command', 'args': {'Name': {'type': 'enum', 'values': ['BOW']}},
                                 'timeoutMs': 1000, 'preconditions': 'SIM MANUAL'},
        'Robot.Motion.Perform.Status.Phase': {'kind': 'sensor', 'type': 'enum', 'generated': True,
                                             'values': ['NONE', 'RUNNING', 'SUCCEEDED'], 'maxAgeMs': 100},
    }
    catalog = {'schema': 'rss-catalog.v1', 'rss': '0.1', 'root': 'Robot', 'nodes': nodes}
    for name in ('Arm', 'Disarm', 'ResetStop', 'Stop'):
        nodes['Robot.Safety.'+name] = {'kind': 'command', 'args': {}, 'timeoutMs': 1000, 'preconditions': 'SIM'}
    for path, node in list(nodes.items()):
        if node['kind'] == 'command':
            for suffix, values in [('Phase', ['NONE', 'PENDING', 'ACCEPTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELLED', 'TIMED_OUT']),
                                   ('ExecutionId', None), ('Reason', None)]:
                nodes[path+'.Status.'+suffix] = {'kind': 'sensor', 'type': 'enum' if values else 'string',
                    'generated': True, 'maxAgeMs': 100, **({'values': values} if values else {})}
    catalog['catalogHash'] = 'sha256:' + hashlib.sha256(canonical(catalog)).hexdigest()
    return catalog


class BrokerFixture(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.catalog = catalog_fixture()
        self.broker = Broker(self.catalog, host_clock_id='test-host', provider_timeout_ms=600)
        self.server = grpc.aio.server()
        rpc.add_BusServicer_to_server(self.broker, self.server)
        rpc.add_ProviderServicer_to_server(self.broker, self.server)
        port = self.server.add_insecure_port('127.0.0.1:0')
        self.address = f'127.0.0.1:{port}'
        await self.broker.start()
        await self.server.start()
        self.channel = grpc.aio.insecure_channel(f'127.0.0.1:{port}')
        await asyncio.wait_for(self.channel.channel_ready(), 5)
        self.bus, self.provider_stub = rpc.BusStub(self.channel), rpc.ProviderStub(self.channel)
        self.calls = []
        self.extra_channels = []
        self.provider = None
        self.hello = None
        self.provider_lock = asyncio.Lock()

    async def asyncTearDown(self):
        for call in self.calls:
            call.cancel()
        for channel in self.extra_channels:
            await channel.close()
        await self.channel.close()
        await self.server.stop(0)
        await self.broker.close()

    def query(self, *paths, interval=0):
        return pb.Query(paths=paths, catalog_hash=self.catalog['catalogHash'], min_interval_ms=interval)

    def make_hello(self, **changes):
        data = dict(provider_id='fixture', profile_id='dog-go2-sim', backend='SIM',
                    catalog_hash=self.catalog['catalogHash'], host_clock_id='test-host',
                    protocol_version=PROTOCOL_VERSION, session=str(uuid.uuid4()),
                    target_context=pb.TargetContext(kind=pb.KINEMATIC_MOCK,mapping_hash='sha256:'+'a'*64,
                        adapter_source_hash='sha256:'+'b'*64,source_epoch='unit-fixture',remote_arm_authorized=True),
                    claims=[p for p, n in self.catalog['nodes'].items()
                            if not p.startswith('Robot.Connection.') and not n.get('generated')])
        data.update(changes)
        return pb.ProviderHello(**data)

    async def attach(self, hello=None):
        self.hello = hello or self.make_hello()
        self.provider = self.provider_stub.Attach()
        self.calls.append(self.provider)
        await self.provider.write(pb.ProviderPacket(hello=self.hello))
        ack = await self.provider.read()
        self.assertTrue(ack.ok)

    def sample(self, path='Robot.Signal.Speed', value=None, sequence=1,
               quality=pb.OK, stamp=None, epoch='scene-1'):
        result = pb.Sample(path=path, sequence=sequence, quality=quality,
                           source_time_ns=time.monotonic_ns() if stamp is None else stamp,
                           source_epoch=epoch, source_clock='MONOTONIC')
        if value is not None:
            result.value.CopyFrom(value)
        return result

    async def send(self, *samples):
        return await self.packet(pb.ProviderPacket(samples=pb.Samples(
            samples=samples, provider_session=self.hello.session)))

    async def packet(self, packet):
        async with self.provider_lock:
            await self.provider.write(packet)
            return await self.provider.read()

    async def subscribe(self, *paths, interval=0):
        call = self.bus.Subscribe(self.query(*paths, interval=interval))
        self.calls.append(call)
        initial = await asyncio.wait_for(call.read(), 2)
        return call, initial


class BrokerDataTests(BrokerFixture):
    async def test_descriptor_and_missing_value_snapshot(self):
        descriptor = await self.bus.Describe(pb.Empty())
        self.assertEqual(descriptor.backend, 'SIM')
        self.assertEqual(descriptor.protocol_version, '1.5')
        self.assertEqual(descriptor.host_clock_id, 'test-host')
        self.assertFalse(descriptor.provider_online)
        snapshot = await self.bus.Get(self.query('Robot.Signal.Speed', 'Robot.Connection.IsOnline'))
        values = {s.path: s for s in snapshot.samples}
        self.assertEqual(values['Robot.Signal.Speed'].quality, pb.NONE)
        self.assertIsNone(values['Robot.Signal.Speed'].value.WhichOneof('kind'))
        self.assertEqual(values['Robot.Connection.IsOnline'].quality, pb.OK)
        self.assertFalse(values['Robot.Connection.IsOnline'].value.bool_value)

    async def test_queries_reject_wrong_hash_path_kind_and_limits(self):
        cases = [(pb.Query(paths=['Robot.Signal.Speed']), 'PB_CATALOG_MISMATCH'),
                 (self.query('Robot.Unknown'), 'PB_INVALID_PATH'),
                 (self.query('Robot.Motion.Perform'), 'PB_INVALID_KIND'),
                 (self.query('Robot.Signal.Speed', interval=60001), 'PB_INVALID_VALUE')]
        for query, expected in cases:
            with self.subTest(expected=expected):
                with self.assertRaises(grpc.aio.AioRpcError) as caught:
                    await self.bus.Get(query)
                self.assertIn(expected, caught.exception.details())

    async def test_provider_hello_rejects_mismatches_and_real_backend(self):
        for changes, expected in [({'catalog_hash': 'wrong'}, 'PB_CATALOG_MISMATCH'),
                                  ({'host_clock_id': 'other-host'}, 'PB_CLOCK_MISMATCH'),
                                  ({'backend': 'REAL'}, 'PB_BACKEND_FORBIDDEN'),
                                  ({'protocol_version': '1.0'}, 'PB_PROVIDER_MISMATCH'),
                                  ({'claims': ['Robot.Connection.IsOnline']}, 'PB_PROVIDER_MISMATCH')]:
            with self.subTest(expected=expected):
                call = self.provider_stub.Attach()
                self.calls.append(call)
                await call.write(pb.ProviderPacket(hello=self.make_hello(**changes)))
                with self.assertRaises(grpc.aio.AioRpcError) as caught:
                    await call.read()
                self.assertIn(expected, caught.exception.details())
                self.assertIsNone(self.broker.provider)

    async def test_handshake_requires_both_control_lanes(self):
        await self.attach()
        snapshot = await self.bus.Get(self.query('Robot.Connection.IsHandshakeComplete'))
        self.assertFalse(snapshot.samples[0].value.bool_value)
        control = self.provider_stub.Control(self.hello)
        safety_channel = grpc.aio.insecure_channel(self.address, options=[('grpc.use_local_subchannel_pool', 1)])
        self.extra_channels.append(safety_channel)
        safety = rpc.ProviderStub(safety_channel).Safety(self.hello)
        self.calls.extend([control, safety])
        await asyncio.wait_for(asyncio.gather(control.initial_metadata(), safety.initial_metadata()), 2)
        snapshot = await self.bus.Get(self.query('Robot.Connection.IsHandshakeComplete'))
        self.assertTrue(snapshot.samples[0].value.bool_value)
        control.cancel()
        for _ in range(20):
            await asyncio.sleep(.01)
            snapshot = await self.bus.Get(self.query('Robot.Connection.IsHandshakeComplete'))
            if not snapshot.samples[0].value.bool_value:
                break
        self.assertFalse(snapshot.samples[0].value.bool_value)

    async def test_same_tcp_safety_lane_is_rejected_by_actual_broker(self):
        await self.attach()
        safety = self.provider_stub.Safety(self.hello)
        self.calls.append(safety)
        with self.assertRaises(grpc.aio.AioRpcError) as caught:
            await safety.read()
        self.assertIn('PB_PROVIDER_MISMATCH', caught.exception.details())
        snapshot = await self.bus.Get(self.query('Robot.Connection.IsHandshakeComplete'))
        self.assertFalse(snapshot.samples[0].value.bool_value)

    async def test_source_clock_cannot_change_inside_provider_session(self):
        await self.attach()
        self.assertTrue((await self.send(self.sample(value=pb.Value(float64_value=.2)))).ok)
        sample = self.sample(value=pb.Value(float64_value=.2), sequence=2)
        sample.source_clock = 'ROS_TIME'
        ack = await self.send(sample)
        self.assertFalse(ack.ok)
        self.assertEqual(ack.code, 'PB_PROVIDER_MISMATCH')

    async def test_actual_stream_sample_get_and_quality_transition(self):
        await self.attach()
        call, initial = await self.subscribe('Robot.Signal.Speed', interval=2000)
        self.assertEqual(initial.samples[0].quality, pb.NONE)
        stamp = time.monotonic_ns()
        ack = await self.send(self.sample(value=pb.Value(float64_value=.3), stamp=stamp))
        self.assertTrue(ack.ok)
        fresh = await asyncio.wait_for(call.read(), .3)
        self.assertEqual(fresh.samples[0].quality, pb.OK)
        self.assertEqual(fresh.samples[0].source_time_ns, stamp)
        self.assertAlmostEqual(fresh.samples[0].value.float64_value, .3)
        stale = await asyncio.wait_for(call.read(), .3)
        self.assertEqual(stale.samples[0].quality, pb.STALE)
        self.assertEqual(stale.samples[0].value, fresh.samples[0].value)
        self.assertEqual(stale.samples[0].sequence, 1)
        # The 2-second value throttle must never hide a safety quality transition.
        snapshot = await self.bus.Get(self.query('Robot.Signal.Speed'))
        self.assertEqual(snapshot.samples[0].quality, pb.STALE)

    async def test_invalid_atomic_batch_does_not_partially_update(self):
        await self.attach()
        ack = await self.send(self.sample(value=pb.Value(float64_value=.4)),
                              self.sample(path='Robot.Signal.Flag', value=pb.Value(float64_value=1)))
        self.assertFalse(ack.ok)
        self.assertEqual(ack.code, 'PB_INVALID_VALUE')
        snapshot = await self.bus.Get(self.query('Robot.Signal.Speed'))
        self.assertEqual(snapshot.samples[0].quality, pb.NONE)

    async def test_values_reject_wrong_type_nan_infinity_bounds_enum_and_uint8(self):
        await self.attach()
        cases = [('Robot.Signal.Speed', pb.Value(int32_value=1)),
                 ('Robot.Signal.Speed', pb.Value(float64_value=float('nan'))),
                 ('Robot.Signal.Speed', pb.Value(float64_value=float('inf'))),
                 ('Robot.Signal.Speed', pb.Value(float64_value=1.1)),
                 ('Robot.Signal.Mode', pb.Value(string_value='UNKNOWN')),
                 ('Robot.Signal.Byte', pb.Value(uint32_value=256))]
        for path, value in cases:
            with self.subTest(path=path, value=value):
                ack = await self.send(self.sample(path=path, value=value))
                self.assertFalse(ack.ok)
                self.assertEqual(ack.code, 'PB_INVALID_VALUE')

    async def test_none_is_unavailable_not_zero_and_never_carries_value(self):
        await self.attach()
        bad = await self.send(self.sample(value=pb.Value(float64_value=0), quality=pb.NONE))
        self.assertFalse(bad.ok)
        good = await self.send(self.sample(quality=pb.NONE))
        self.assertTrue(good.ok)
        snapshot = await self.bus.Get(self.query('Robot.Signal.Speed'))
        self.assertEqual(snapshot.samples[0].quality, pb.NONE)
        self.assertIsNone(snapshot.samples[0].value.WhichOneof('kind'))

    async def test_duplicate_out_of_order_and_source_epoch_require_reattachment(self):
        await self.attach()
        stamp = time.monotonic_ns()
        self.assertTrue((await self.send(self.sample(value=pb.Value(float64_value=.2), sequence=2, stamp=stamp))).ok)
        for sample, code in [(self.sample(value=pb.Value(float64_value=.2), sequence=2), 'PB_REPLAY'),
                             (self.sample(value=pb.Value(float64_value=.2), sequence=1), 'PB_REPLAY'),
                             (self.sample(value=pb.Value(float64_value=.2), sequence=3, stamp=stamp-1), 'PB_REPLAY'),
                             (self.sample(value=pb.Value(float64_value=.2), sequence=3, epoch='scene-2'), 'PB_PROVIDER_MISMATCH')]:
            ack = await self.send(sample)
            self.assertFalse(ack.ok)
            self.assertEqual(ack.code, code)

    async def test_repeated_capture_stamp_cannot_keep_frozen_sensor_fresh(self):
        await self.attach()
        stamp = time.monotonic_ns()
        for seq in range(1, 7):
            ack = await self.send(self.sample(value=pb.Value(float64_value=.2), sequence=seq, stamp=stamp))
            self.assertTrue(ack.ok)
            await asyncio.sleep(.02)
        snapshot = await self.bus.Get(self.query('Robot.Signal.Speed'))
        self.assertEqual(snapshot.samples[0].quality, pb.STALE)
        self.assertEqual(snapshot.samples[0].source_time_ns, stamp)

    async def test_values_coalesce_and_respect_minimum_interval(self):
        await self.attach()
        call, _ = await self.subscribe('Robot.Signal.Flag', interval=100)
        self.assertTrue((await self.send(self.sample(path='Robot.Signal.Flag', value=pb.Value(bool_value=False)))).ok)
        await asyncio.wait_for(call.read(), 1)
        pending = asyncio.create_task(call.read())
        for seq, value in [(2, True), (3, False), (4, True)]:
            self.assertTrue((await self.send(self.sample(path='Robot.Signal.Flag',
                            value=pb.Value(bool_value=value), sequence=seq))).ok)
        await asyncio.sleep(.03)
        self.assertFalse(pending.done())
        batch = await asyncio.wait_for(pending, .3)
        self.assertTrue(batch.samples[-1].value.bool_value)
        self.assertEqual(batch.samples[-1].sequence, 4)

    async def test_transient_quality_transitions_are_not_coalesced_away(self):
        await self.attach()
        call, _ = await self.subscribe('Robot.Signal.Speed', interval=1000)
        await self.send(self.sample(value=pb.Value(float64_value=.1)))
        await self.send(self.sample(quality=pb.NONE, sequence=2))
        await self.send(self.sample(value=pb.Value(float64_value=.2), sequence=3))
        qualities = []
        while len(qualities) < 3:
            batch = await asyncio.wait_for(call.read(), .3)
            qualities.extend(s.quality for s in batch.samples)
        self.assertEqual(qualities[:3], [pb.OK, pb.NONE, pb.OK])

    async def test_provider_heartbeat_timeout_marks_offline_and_existing_samples_stale(self):
        await self.attach()
        await self.send(self.sample(path='Robot.Identity.Model', value=pb.Value(string_value='Go2')))
        await asyncio.sleep(.65)
        snapshot = await self.bus.Get(self.query('Robot.Connection.IsOnline', 'Robot.Identity.Model'))
        samples = {s.path: s for s in snapshot.samples}
        self.assertFalse(samples['Robot.Connection.IsOnline'].value.bool_value)
        self.assertEqual(samples['Robot.Identity.Model'].quality, pb.STALE)
        self.assertFalse((await self.bus.Describe(pb.Empty())).provider_online)

    async def test_second_provider_cannot_replace_existing_session(self):
        await self.attach()
        second = self.provider_stub.Attach()
        self.calls.append(second)
        await second.write(pb.ProviderPacket(hello=self.make_hello()))
        with self.assertRaises(grpc.aio.AioRpcError) as caught:
            await second.read()
        self.assertIn('PB_RESOURCE_BUSY', caught.exception.details())
        self.assertEqual(self.broker.provider.hello.session, self.hello.session)


class CatalogAndBoundsTests(unittest.TestCase):
    def test_catalog_hash_duplicate_keys_and_schema_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'catalog.json'
            catalog = catalog_fixture()
            path.write_text(json.dumps(catalog))
            self.assertEqual(load_catalog(path)['catalogHash'], catalog['catalogHash'])
            catalog['nodes']['Robot.Signal.Speed']['max'] = 2
            path.write_text(json.dumps(catalog))
            with self.assertRaisesRegex(BusError, 'PB_CATALOG_MISMATCH'):
                load_catalog(path)
            path.write_text('{"nodes":{},"nodes":{}}')
            with self.assertRaisesRegex(BusError, 'PB_INVALID_VALUE'):
                load_catalog(path)

    def test_slow_subscriber_quality_queue_is_bounded_and_fails_explicitly(self):
        subscriber = Subscriber({'Robot.Signal.Speed'}, 0)
        for index in range(600):
            subscriber.notify(pb.Sample(path='Robot.Signal.Speed', sequence=index,
                                        quality=pb.OK if index % 2 else pb.STALE), True)
        self.assertEqual(len(subscriber.qualities), 512)
        self.assertEqual(subscriber.failure, 'PB_QUEUE_FULL')
        self.assertEqual(len(subscriber.values), 0)

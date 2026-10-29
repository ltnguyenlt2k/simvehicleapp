"""Lease/TTL RPC tests against actual broker/provider stream sockets."""
import asyncio
import time
import unittest

import grpc
from broker import Broker, BusError
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc
from test_broker_data import BrokerFixture, catalog_fixture


class ControlFixture(BrokerFixture):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await self.attach()
        self.control = self.provider_stub.Control(self.hello)
        channel = grpc.aio.insecure_channel(self.address, options=[('grpc.use_local_subchannel_pool', 1)])
        self.extra_channels.append(channel)
        self.safety = rpc.ProviderStub(channel).Safety(self.hello)
        self.calls.extend([self.control, self.safety])
        await asyncio.wait_for(asyncio.gather(self.control.initial_metadata(), self.safety.initial_metadata()), 2)
        self.heartbeat = asyncio.create_task(self.beat())

    async def asyncTearDown(self):
        self.heartbeat.cancel()
        await asyncio.gather(self.heartbeat, return_exceptions=True)
        await super().asyncTearDown()

    async def beat(self):
        try:
            while True:
                await asyncio.sleep(.1)
                await self.packet(pb.ProviderPacket(heartbeat_session=self.hello.session))
        except (grpc.aio.AioRpcError, asyncio.InvalidStateError):
            return

    async def next_kind(self, lane, kind, timeout=1):
        deadline = time.monotonic() + timeout
        while True:
            message = await asyncio.wait_for(lane.read(), max(.001, deadline-time.monotonic()))
            if message.kind == kind:
                return message

    async def acquire(self, ttl=1000, client='app-1'):
        lease = await self.bus.AcquireLease(pb.LeaseRequest(client_id=client,
                            catalog_hash=self.catalog['catalogHash'], ttl_ms=ttl))
        notice = await self.next_kind(self.control, pb.LEASE_UPDATE)
        self.assertEqual(notice.fence, lease.fence)
        self.assertEqual(notice.broker_epoch, lease.broker_epoch)
        self.assertGreater(notice.deadline_monotonic_ns, time.monotonic_ns())
        return lease

    def target(self, lease, value=.2, sequence=1, owner='hold-1', release=False):
        return pb.Target(lease=lease, path='Robot.Motion.Velocity', sequence=sequence,
                         owner_id=owner, release=release,
                         value=pb.Object(fields={'LinearX': pb.Value(float64_value=value)}))

    async def assert_rpc_error(self, awaitable, expected):
        with self.assertRaises(grpc.aio.AioRpcError) as caught:
            await awaitable
        self.assertIn(expected, caught.exception.details())


class LeaseAndTargetTests(ControlFixture):
    async def test_one_lease_fencing_release_and_new_grant(self):
        first = await self.acquire()
        self.assertTrue(first.token)
        await self.assert_rpc_error(self.bus.AcquireLease(pb.LeaseRequest(client_id='other',
            catalog_hash=self.catalog['catalogHash'], ttl_ms=1000)), 'PB_LEASE_BUSY')
        self.assertTrue((await self.bus.ReleaseLease(first)).ok)
        notice = await self.next_kind(self.safety, pb.LEASE_REVOKED)
        self.assertEqual(notice.fence, first.fence)
        second = await self.acquire(client='other')
        self.assertGreater(second.fence, first.fence)
        self.assertNotEqual(second.token, first.token)
        await self.assert_rpc_error(self.bus.RenewLease(first), 'PB_LEASE_EXPIRED')

    async def test_lease_limits_catalog_epoch_and_token_fail_closed(self):
        for ttl in (1, 99, 5001):
            await self.assert_rpc_error(self.bus.AcquireLease(pb.LeaseRequest(client_id='app',
                catalog_hash=self.catalog['catalogHash'], ttl_ms=ttl)), 'PB_INVALID_VALUE')
        await self.assert_rpc_error(self.bus.AcquireLease(pb.LeaseRequest(client_id='app',
            catalog_hash='wrong', ttl_ms=1000)), 'PB_CATALOG_MISMATCH')
        lease = await self.acquire()
        forged = pb.Lease()
        forged.CopyFrom(lease)
        forged.broker_epoch = 'previous-broker'
        await self.assert_rpc_error(self.bus.RenewLease(forged), 'PB_LEASE_EXPIRED')
        forged.CopyFrom(lease)
        forged.token = 'unknown'
        await self.assert_rpc_error(self.bus.ReleaseLease(forged), 'PB_LEASE_EXPIRED')
        self.assertEqual(self.broker.lease.token, lease.token)

    async def test_ttl_expiry_dispatches_safe_value_once_without_lease_renewal(self):
        lease = await self.acquire()
        self.assertTrue((await self.bus.SetTarget(self.target(lease))).ok)
        dispatch = await self.next_kind(self.control, pb.SET_TARGET)
        start = time.monotonic()
        safe = await self.next_kind(self.safety, pb.SAFE_VALUE)
        elapsed = time.monotonic()-start
        self.assertLessEqual(elapsed, .35)
        self.assertEqual(safe.value.fields['LinearX'].float64_value, 0)
        self.assertEqual(safe.reason, 'TARGET_EXPIRED')
        self.assertEqual(safe.sequence, dispatch.sequence)
        self.assertNotIn('Robot.Motion.Velocity', self.broker.targets)
        pending = asyncio.create_task(self.safety.read())
        await asyncio.sleep(.06)
        self.assertFalse(pending.done(), 'safeValue must not be emitted repeatedly')
        pending.cancel()
        await asyncio.gather(pending, return_exceptions=True)
        print(f'Target TTL -> actual Safety receipt {elapsed:.4f}s (limit 0.350s)')

    async def test_lease_expiry_bounds_target_deadline_and_revokes_fence(self):
        lease = await self.acquire(ttl=100)
        await self.bus.SetTarget(self.target(lease))
        dispatch = await self.next_kind(self.control, pb.SET_TARGET)
        self.assertLessEqual(dispatch.valid_for_ms, 100)
        safe = await self.next_kind(self.safety, pb.SAFE_VALUE)
        self.assertEqual(safe.reason, 'LEASE_EXPIRED')
        revoked = await self.next_kind(self.safety, pb.LEASE_REVOKED)
        self.assertEqual(revoked.fence, lease.fence)
        self.assertIsNone(self.broker.lease)
        await self.assert_rpc_error(self.bus.SetTarget(self.target(lease, sequence=2)), 'PB_LEASE_EXPIRED')

    async def test_renew_lease_does_not_renew_target(self):
        lease = await self.acquire(ttl=500)
        await self.bus.SetTarget(self.target(lease))
        initial = await self.next_kind(self.control, pb.SET_TARGET)
        start = time.monotonic()
        await asyncio.sleep(.18)
        # Client remaining_ms is not authority to choose a longer renewal TTL.
        lease.remaining_ms = 2**32-1
        renewed = await self.bus.RenewLease(lease)
        self.assertLessEqual(renewed.remaining_ms, 500)
        notice = await self.next_kind(self.control, pb.LEASE_UPDATE)
        self.assertGreater(notice.deadline_monotonic_ns, initial.deadline_monotonic_ns)
        safe = await self.next_kind(self.safety, pb.SAFE_VALUE)
        self.assertEqual(safe.reason, 'TARGET_EXPIRED')
        self.assertLessEqual(time.monotonic()-start, .35)
        self.assertIsNotNone(self.broker.lease)

    async def test_fresh_setpoint_extends_only_its_current_target_deadline(self):
        lease = await self.acquire()
        await self.bus.SetTarget(self.target(lease))
        await self.next_kind(self.control, pb.SET_TARGET)
        pending = asyncio.create_task(self.safety.read())
        await asyncio.sleep(.18)
        await self.bus.SetTarget(self.target(lease, value=.3, sequence=2))
        fresh = await self.next_kind(self.control, pb.SET_TARGET)
        await asyncio.sleep(.16)
        self.assertFalse(pending.done(), 'old target expiry must not stop a fresh target')
        safe = await asyncio.wait_for(pending, .3)
        self.assertEqual(safe.kind, pb.SAFE_VALUE)
        self.assertEqual(safe.sequence, fresh.sequence)

    async def test_explicit_safe_release_allows_next_hold_and_rejects_competing_owner(self):
        lease = await self.acquire()
        await self.bus.SetTarget(self.target(lease))
        await self.next_kind(self.control, pb.SET_TARGET)
        await self.assert_rpc_error(self.bus.SetTarget(self.target(lease, sequence=2, owner='other')),
                                    'PB_RESOURCE_BUSY')
        await self.assert_rpc_error(self.bus.SetTarget(self.target(lease, value=.1, sequence=2, release=True)),
                                    'PB_INVALID_VALUE')
        await self.bus.SetTarget(self.target(lease, value=0, sequence=2, release=True))
        safe = await self.next_kind(self.safety, pb.SAFE_VALUE)
        self.assertEqual(safe.reason, 'TARGET_RELEASED')
        self.assertEqual(safe.owner_id, 'hold-1')
        await self.bus.SetTarget(self.target(lease, sequence=3, owner='other'))
        new = await self.next_kind(self.control, pb.SET_TARGET)
        self.assertEqual(new.owner_id, 'other')

    async def test_target_replay_complete_types_bounds_and_owner_validation(self):
        lease = await self.acquire()
        for mutate in (lambda t: setattr(t, 'owner_id', ''),
                       lambda t: t.value.fields.clear(),
                       lambda t: t.value.fields['Extra'].CopyFrom(pb.Value(float64_value=0)),
                       lambda t: t.value.fields['LinearX'].CopyFrom(pb.Value(bool_value=False)),
                       lambda t: t.value.fields['LinearX'].CopyFrom(pb.Value(float64_value=float('nan'))),
                       lambda t: t.value.fields['LinearX'].CopyFrom(pb.Value(float64_value=.6))):
            target = self.target(lease)
            mutate(target)
            await self.assert_rpc_error(self.bus.SetTarget(target), 'PB_INVALID_VALUE')
            self.assertFalse(self.broker.targets)
        await self.bus.SetTarget(self.target(lease))
        await self.next_kind(self.control, pb.SET_TARGET)
        await self.assert_rpc_error(self.bus.SetTarget(self.target(lease)), 'PB_REPLAY')
        await self.assert_rpc_error(self.bus.SetTarget(self.target(pb.Lease(), sequence=2)), 'PB_LEASE_REQUIRED')

    async def test_release_lease_zeroes_target_and_revokes_even_without_target(self):
        lease = await self.acquire()
        await self.bus.SetTarget(self.target(lease))
        await self.next_kind(self.control, pb.SET_TARGET)
        await self.bus.ReleaseLease(lease)
        safe = await self.next_kind(self.safety, pb.SAFE_VALUE)
        self.assertEqual(safe.reason, 'LEASE_RELEASED')
        self.assertEqual((await self.next_kind(self.safety, pb.LEASE_REVOKED)).fence, lease.fence)
        self.assertFalse(self.broker.targets)
        second = await self.acquire()
        await self.bus.ReleaseLease(second)
        self.assertEqual((await self.next_kind(self.safety, pb.LEASE_REVOKED)).fence, second.fence)

    async def test_loss_of_control_lane_revokes_lease_and_dispatches_safe_value(self):
        lease = await self.acquire()
        await self.bus.SetTarget(self.target(lease))
        await self.next_kind(self.control, pb.SET_TARGET)
        self.control.cancel()
        safe = await self.next_kind(self.safety, pb.SAFE_VALUE)
        self.assertEqual(safe.reason, 'CONTROL_LANE_LOST')
        self.assertIsNone(self.broker.lease)
        await self.assert_rpc_error(self.bus.AcquireLease(pb.LeaseRequest(client_id='new',
            catalog_hash=self.catalog['catalogHash'], ttl_ms=1000)), 'PB_PROVIDER_OFFLINE')

    async def test_data_provider_disconnect_revokes_old_authority(self):
        lease = await self.acquire()
        await self.bus.SetTarget(self.target(lease))
        await self.next_kind(self.control, pb.SET_TARGET)
        self.provider.cancel()
        safe = await self.next_kind(self.safety, pb.SAFE_VALUE)
        self.assertEqual(safe.reason, 'PROVIDER_LOST')
        self.assertIsNone(self.broker.lease)
        self.assertFalse((await self.bus.Describe(pb.Empty())).provider_online)

    async def test_safety_lane_loss_revokes_lease_and_prevents_new_control(self):
        lease = await self.acquire()
        await self.bus.SetTarget(self.target(lease))
        await self.next_kind(self.control, pb.SET_TARGET)
        self.safety.cancel()
        for _ in range(30):
            if self.broker.lease is None:
                break
            await asyncio.sleep(.01)
        self.assertIsNone(self.broker.lease)
        self.assertFalse(self.broker.targets)
        await self.assert_rpc_error(self.bus.AcquireLease(pb.LeaseRequest(client_id='new',
            catalog_hash=self.catalog['catalogHash'], ttl_ms=1000)), 'PB_PROVIDER_OFFLINE')

    async def test_lease_with_no_active_setpoint_still_notifies_expiry(self):
        lease = await self.acquire(ttl=100)
        revoked = await self.next_kind(self.safety, pb.LEASE_REVOKED)
        self.assertEqual(revoked.fence, lease.fence)
        self.assertEqual(revoked.reason, 'LEASE_EXPIRED')
        await self.assert_rpc_error(self.bus.RenewLease(lease), 'PB_LEASE_EXPIRED')


class CatalogSafetyTests(unittest.TestCase):
    def test_unsafe_catalog_safe_value_is_rejected_before_startup(self):
        for scalar in (.2, 1, False):
            catalog = catalog_fixture()
            catalog['nodes']['Robot.Motion.Velocity']['safeValue']['LinearX'] = scalar
            with self.subTest(scalar=scalar):
                with self.assertRaises(BusError):
                    Broker(catalog, host_clock_id='test-host')

import asyncio
import copy
import json
from pathlib import Path
import time
import unittest
import uuid

import grpc
from broker import Broker, load_catalog
from mock import MockBackend, MockControl
from provider import AuthorityGuard, ProviderClient
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc
from protobus.mock.v1 import mock_pb2 as mpb
from protobus.mock.v1 import mock_pb2_grpc as mrpc


class GuardTests(unittest.TestCase):
    def message(self, kind, fence=1, sequence=1, deadline=1000, epoch='broker', session='provider'):
        return pb.Dispatch(kind=kind, fence=fence, sequence=sequence,
            deadline_monotonic_ns=deadline, broker_epoch=epoch, provider_session=session,
            path='Robot.Motion.Velocity', execution_id='operation')

    def test_receive_side_deadlines_sequence_and_cancel_tombstones(self):
        guard = AuthorityGuard('broker', 'provider')
        self.assertFalse(guard.target(self.message(pb.SET_TARGET), 100))
        self.assertTrue(guard.grant(self.message(pb.LEASE_UPDATE), 100))
        target = self.message(pb.SET_TARGET, deadline=300)
        self.assertTrue(guard.target(target, 100))
        self.assertFalse(guard.target(target, 110))
        self.assertFalse(guard.target(self.message(pb.SET_TARGET, sequence=2, deadline=200), 210))
        self.assertFalse(guard.target(self.message(pb.SET_TARGET, sequence=2, epoch='old'), 110))
        self.assertTrue(guard.invocation(self.message(pb.INVOKE), 110))
        self.assertFalse(guard.invocation(self.message(pb.INVOKE), 110))
        guard.cancelled.add('before-start')
        command = self.message(pb.INVOKE)
        command.execution_id = 'before-start'
        self.assertFalse(guard.invocation(command, 110))

    def test_old_safe_revoke_and_lease_notice_cannot_override_new_fence(self):
        guard = AuthorityGuard('broker', 'provider')
        self.assertTrue(guard.grant(self.message(pb.LEASE_UPDATE, deadline=2000), 100))
        self.assertTrue(guard.grant(self.message(pb.LEASE_UPDATE, fence=3, deadline=600), 100))
        self.assertEqual(guard.lease_deadline, 600, 'new grant must not inherit longer old duration')
        self.assertTrue(guard.target(self.message(pb.SET_TARGET, fence=3, deadline=400), 100))
        self.assertFalse(guard.safe(self.message(pb.SAFE_VALUE, fence=1)))
        self.assertFalse(guard.revoke(self.message(pb.LEASE_REVOKED, fence=1)))
        self.assertIn('Robot.Motion.Velocity', guard.targets)
        self.assertFalse(guard.grant(self.message(pb.LEASE_UPDATE, fence=1, deadline=3000), 100))
        self.assertTrue(guard.revoke(self.message(pb.STOP, fence=4)))
        self.assertFalse(guard.grant(self.message(pb.LEASE_UPDATE, fence=3), 100))
        self.assertTrue(guard.grant(self.message(pb.LEASE_UPDATE, fence=5), 100))
        self.assertFalse(guard.revoke(self.message(pb.STOP, fence=4)))
        self.assertEqual(guard.fence, 5)


class DelayedDeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_fresh_queued_refresh_cannot_hide_an_expired_previous_target(self):
        catalog = load_catalog('/contracts/fixtures/rss-go2-catalog.v1.json')
        backend = MockBackend(catalog)
        client = ProviderClient('unused:1', catalog, backend)
        client.guard = AuthorityGuard('epoch', 'session')
        guard = client.guard
        now = time.monotonic_ns()
        common = dict(broker_epoch='epoch', provider_session='session', fence=1)
        guard.grant(pb.Dispatch(kind=pb.LEASE_UPDATE,
            deadline_monotonic_ns=now+2_000_000_000, **common), now)
        value = pb.Object(fields={'LinearX': pb.Value(float64_value=.2),
                                 'AngularZ': pb.Value(float64_value=0)})
        previous = pb.Dispatch(kind=pb.SET_TARGET, path='Robot.Motion.Velocity',
            sequence=1, value=value, deadline_monotonic_ns=now+100_000_000, **common)
        self.assertTrue(guard.target(previous, now))
        backend.mode = 'MANUAL'
        backend.target(previous.path, value, previous.deadline_monotonic_ns)
        guard.targets[previous.path].deadline_monotonic_ns = now-1
        async def queued():
            yield pb.Dispatch(kind=pb.SET_TARGET, path=previous.path, value=value,
                sequence=2, deadline_monotonic_ns=now+300_000_000, **common)
        await client.control_loop(queued())
        self.assertEqual(backend.v, 0)
        self.assertTrue(backend.stop_latched)
        self.assertTrue(client.restart.is_set())
        self.assertEqual(guard.lease_deadline, 0)
        self.assertGreaterEqual(guard.invalid_through, 1)


class MockIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_state_observer_labels_synthetic_model_and_has_no_write_authority(self):
        state = await self.api.State(pb.Empty())
        self.assertEqual(state.model, 'synthetic-unicycle')
        self.assertEqual(state.mode, 'DISARMED')
        self.assertTrue(state.connected)
        self.assertEqual(state.session, self.client.guard.session)
        self.assertEqual(state.linear_x, 0)
        self.assertEqual(state.angular_z, 0)
        self.assertIsNone(self.broker.lease)

    async def asyncSetUp(self):
        self.catalog = load_catalog('/contracts/fixtures/rss-go2-catalog.v1.json')
        self.broker = Broker(self.catalog, provider_timeout_ms=800)
        self.server = grpc.aio.server()
        rpc.add_BusServicer_to_server(self.broker, self.server)
        rpc.add_ProviderServicer_to_server(self.broker, self.server)
        port = self.server.add_insecure_port('127.0.0.1:0')
        await self.broker.start()
        await self.server.start()
        self.address = f'127.0.0.1:{port}'
        self.channel = grpc.aio.insecure_channel(self.address)
        self.bus = rpc.BusStub(self.channel)
        profile = json.loads((Path(__file__).resolve().parents[1]/'profiles/mock-go2.json').read_text())
        profile['motionDurationSeconds'] = {key: .08 for key in profile['motionDurationSeconds']}
        profile['recoverySeconds'] = .03
        profile['durationSource'] = 'TEST_ONLY synthetic short profile; no physical timing evidence'
        self.backend = MockBackend(self.catalog, profile)
        self.client = ProviderClient(self.address, self.catalog, self.backend, provider_id='mock-test')
        self.provider_task = asyncio.create_task(self.client.run())
        self.api_server = grpc.aio.server()
        mrpc.add_MockControlServicer_to_server(MockControl(self.backend), self.api_server)
        api_port = self.api_server.add_insecure_port('127.0.0.1:0')
        await self.api_server.start()
        self.api_channel = grpc.aio.insecure_channel(f'127.0.0.1:{api_port}')
        self.api = mrpc.MockControlStub(self.api_channel)
        self.lease = None
        self.renew_task = None
        self.calls = []
        await self.until(lambda: self.client.connected.is_set() and self.broker.provider is not None
                         and self.broker.provider.safety_ready and self.broker.provider.control_ready)
        await self.wait_value('Robot.Safety.Mode', lambda sample: sample.quality == pb.OK)

    async def asyncTearDown(self):
        if self.renew_task:
            self.renew_task.cancel()
            await asyncio.gather(self.renew_task, return_exceptions=True)
        for call in self.calls:
            call.cancel()
        if self.backend.scenario_task:
            self.backend.scenario_task.cancel()
            await asyncio.gather(self.backend.scenario_task, return_exceptions=True)
        self.provider_task.cancel()
        await asyncio.wait_for(asyncio.gather(self.provider_task, return_exceptions=True), 3)
        await self.api_channel.close()
        await self.api_server.stop(0)
        await self.channel.close()
        await self.server.stop(0)
        await self.broker.close()

    async def until(self, predicate, timeout=3):
        end = time.monotonic()+timeout
        while time.monotonic() < end:
            if predicate():
                return
            await asyncio.sleep(.01)
        self.fail('provider/model condition timed out')

    async def get(self, path):
        return (await self.bus.Get(pb.Query(paths=[path], catalog_hash=self.catalog['catalogHash']))).samples[0]

    async def wait_value(self, path, predicate, timeout=3):
        end = time.monotonic()+timeout
        last = None
        while time.monotonic() < end:
            last = await self.get(path)
            if predicate(last):
                return last
            await asyncio.sleep(.02)
        self.fail(f'RSS condition timed out: {last}')

    async def acquire(self):
        self.lease = await self.bus.AcquireLease(pb.LeaseRequest(client_id='integration-app',
            catalog_hash=self.catalog['catalogHash'], ttl_ms=500))
        async def renew():
            try:
                while True:
                    await asyncio.sleep(.1)
                    self.lease = await self.bus.RenewLease(self.lease)
            except grpc.aio.AioRpcError:
                return
        self.renew_task = asyncio.create_task(renew())

    def invocation(self, path, args=None, timeout=0):
        return pb.Invocation(lease=self.lease, path=path, args=pb.Object(fields=args or {}),
                             idempotency_key=str(uuid.uuid4()), timeout_ms=timeout)

    async def invoke(self, path, args=None, timeout=0):
        call = self.bus.Invoke(self.invocation(path, args, timeout))
        self.calls.append(call)
        return [update async for update in call]

    async def arm(self):
        await self.acquire()
        updates = await self.invoke('Robot.Safety.Arm')
        self.assertEqual(updates[-1].phase, pb.SUCCEEDED, updates)
        await self.wait_value('Robot.Safety.Mode', lambda sample: sample.value.string_value == 'MANUAL')

    async def reconnect_after_profile_fixture_change(self):
        # These tests deliberately replace model configuration before Arm. The
        # immutable target context must change sessions; perform explicit wire
        # recovery in this test fixture instead of bypassing the context guard.
        self.assertIsNone(self.broker.lease)
        previous=self.client.guard.session;self.client.restart.set()
        await self.until(lambda:self.client.connected.is_set() and self.client.guard.session!=previous
            and self.broker.provider is not None and self.broker.provider.safety_ready and self.broker.provider.control_ready)
        await self.acquire()
        result=await self.invoke('Robot.Safety.ResetStop')
        self.assertEqual(result[-1].phase,pb.SUCCEEDED,result)
        self.renew_task.cancel();await asyncio.gather(self.renew_task,return_exceptions=True);self.renew_task=None
        await self.bus.ReleaseLease(self.lease);self.lease=None

    async def test_actual_profile_context_change_revokes_old_authority_without_motion_replay(self):
        await self.arm()
        await self.bus.SetTarget(self.target(1))
        await self.until(lambda:self.backend.v>0)
        previous=self.client.guard.session
        self.backend.profile['recoverySeconds']+=.001
        await self.until(lambda:self.client.connected.is_set() and self.client.guard.session!=previous
            and self.broker.provider is not None and self.broker.provider.control_ready and self.broker.provider.safety_ready)
        self.assertIsNone(self.broker.lease)
        self.assertEqual(self.backend.v,0)
        self.assertEqual(self.backend.mode,'SAFE_STOP')
        descriptor=await self.bus.Describe(pb.Empty())
        self.assertEqual(descriptor.target_context,self.backend.target_context(self.client.guard.session))
        self.assertNotEqual(descriptor.provider_session,previous)
        with self.assertRaises(grpc.aio.AioRpcError):await self.bus.SetTarget(self.target(2))
        await asyncio.sleep(.05)
        self.assertEqual(self.backend.v,0)

    def target(self, sequence, linear=.2, release=False):
        return pb.Target(lease=self.lease, path='Robot.Motion.Velocity', owner_id='integration-hold',
            sequence=sequence, release=release, value=pb.Object(fields={
                'LinearX': pb.Value(float64_value=linear), 'AngularZ': pb.Value(float64_value=0)}))

    async def test_startup_disarmed_and_real_rpc_mode_precondition_rejection(self):
        self.assertEqual((await self.get('Robot.Safety.Mode')).value.string_value, 'DISARMED')
        self.assertIn('mock', (await self.get('Robot.Identity.Model')).value.string_value)
        await self.acquire()
        updates = await self.invoke('Robot.Motion.Perform', {'Name': pb.Value(string_value='BOW')})
        self.assertEqual(updates[-1].phase, pb.REJECTED)
        self.assertTrue(updates[-1].physical_confirmed)
        self.assertFalse(self.backend.motion_active)

    async def test_kinematic_velocity_changes_pose_and_ttl_stops_actual_model(self):
        await self.arm()
        await self.bus.SetTarget(self.target(1))
        await self.wait_value('Robot.Pose.Position.X', lambda sample: sample.quality == pb.OK and sample.value.float64_value > .025)
        # Local target expiry intentionally replaces the provider session. The
        # broker retains old values as STALE during that interval; a zero value
        # alone is not fresh stopped-state evidence. Await the same assertion
        # on the actual replacement session without extending any safety timer.
        stopped = await self.wait_value('Robot.Velocity.Linear.X', lambda sample: sample.quality == pb.OK and sample.value.float64_value == 0)
        self.assertEqual(stopped.quality, pb.OK)
        pose = (await self.get('Robot.Pose.Position.X')).value.float64_value
        self.assertGreater(pose, .025)
        self.assertLessEqual(pose, .075)
        self.assertEqual(self.backend.v, 0)

    async def test_all_five_motion_lifecycles_use_backend_results(self):
        await self.arm()
        for name in self.backend.profile['motionDurationSeconds']:
            with self.subTest(name=name):
                updates = await self.invoke('Robot.Motion.Perform', {'Name': pb.Value(string_value=name)})
                self.assertEqual([u.phase for u in updates], [pb.PENDING, pb.ACCEPTED, pb.RUNNING, pb.SUCCEEDED])
                self.assertTrue(updates[-1].physical_confirmed)
                self.assertFalse(self.backend.motion_active)
                self.assertEqual(self.backend.mode, 'MANUAL')

    async def test_default_measured_profile_duration_is_used_without_time_scaling(self):
        self.backend.profile = json.loads((Path(__file__).resolve().parents[1]/'profiles/mock-go2.json').read_text())
        await self.reconnect_after_profile_fixture_change()
        await self.arm()
        start = time.monotonic()
        result = await self.invoke('Robot.Motion.Perform', {'Name': pb.Value(string_value='BOW')})
        elapsed = time.monotonic()-start
        self.assertEqual(result[-1].phase, pb.SUCCEEDED)
        self.assertGreaterEqual(elapsed, 7.179)
        self.assertLess(elapsed, 10)

    async def test_scenario_sensor_timeline_and_forced_result_go_through_real_bus(self):
        await self.arm()
        start = time.monotonic()
        await self.api.Schedule(mpb.ScenarioRequest(steps=[mpb.ScenarioStep(at_ms=120,
            sensor=mpb.SensorOverride(path='Robot.Perception.Marker.Count', value=pb.Value(uint32_value=1), quality=pb.OK))]))
        await asyncio.sleep(.04)
        self.assertEqual((await self.get('Robot.Perception.Marker.Count')).value.uint32_value, 0)
        await self.wait_value('Robot.Perception.Marker.Count', lambda sample: sample.value.uint32_value == 1)
        self.assertGreaterEqual(time.monotonic()-start, .12)
        for phase in (pb.REJECTED, pb.FAILED, pb.TIMED_OUT):
            await self.api.Schedule(mpb.ScenarioRequest(steps=[mpb.ScenarioStep(at_ms=0,
                command_result=mpb.ForcedResult(path='Robot.Motion.Perform', phase=phase, count=1))]))
            await asyncio.sleep(.02)
            result = await self.invoke('Robot.Motion.Perform', {'Name': pb.Value(string_value='BOW')}, timeout=100)
            self.assertEqual(result[-1].phase, phase)
            await self.until(lambda: not self.broker.draining)

    async def test_scenario_rejects_safety_forgery_bad_type_and_time_scale(self):
        with self.assertRaises(grpc.aio.AioRpcError):
            await self.api.Reset(mpb.ResetRequest(time_scale=2))
        for path, value in [('Robot.Safety.Mode', pb.Value(string_value='MANUAL')),
                            ('Robot.Perception.Marker.Count', pb.Value(bool_value=True))]:
            with self.assertRaises(grpc.aio.AioRpcError):
                await self.api.Schedule(mpb.ScenarioRequest(steps=[mpb.ScenarioStep(sensor=
                    mpb.SensorOverride(path=path, value=value, quality=pb.OK))]))

    async def test_stop_confirms_model_state_and_connection_loss_never_resumes_motion(self):
        await self.arm()
        await self.bus.SetTarget(self.target(1))
        await self.wait_value('Robot.Velocity.Linear.X', lambda sample: sample.value.float64_value > 0)
        stopped = await self.bus.Stop(pb.StopRequest(reason='integration stop'))
        self.assertTrue(stopped.dispatched and stopped.robot_confirmed)
        self.assertTrue(self.backend.stop_latched)
        self.assertEqual(self.backend.v, 0)
        await self.server.stop(0)
        await self.until(lambda: not self.client.connected.is_set())
        self.assertEqual(self.backend.v, 0)
        self.assertNotEqual(self.backend.mode, 'MANUAL')

    async def test_expired_and_old_sequence_dispatches_are_ignored_after_actual_wire_delivery(self):
        await self.arm()
        await self.bus.SetTarget(self.target(1))
        await self.wait_value('Robot.Velocity.Linear.X', lambda sample: sample.value.float64_value > 0)
        await self.bus.SetTarget(self.target(2, linear=0, release=True))
        await self.until(lambda: self.backend.v == 0)
        await self.bus.SetTarget(self.target(3, linear=.1))
        await self.until(lambda: self.backend.v == .1)
        common = dict(path='Robot.Motion.Velocity', fence=self.lease.fence, broker_epoch=self.broker.epoch,
            provider_session=self.client.guard.session, owner_id='integration-hold')
        self.broker.provider.safety_queue.put_nowait(pb.Dispatch(kind=pb.SAFE_VALUE, sequence=1,
            value=self.target(1, linear=0).value, **common))
        self.broker.provider.control_queue.put_nowait(pb.Dispatch(kind=pb.SET_TARGET, sequence=100,
            value=self.target(1, linear=.5).value, deadline_monotonic_ns=time.monotonic_ns()-1, **common))
        await asyncio.sleep(.06)
        self.assertEqual(self.backend.v, .1)
        self.assertEqual(self.client.guard.sequences['Robot.Motion.Velocity'], 3)

    async def test_reset_is_idle_only_and_restarts_source_epoch(self):
        previous = self.client.guard.session
        response = await self.api.Reset(mpb.ResetRequest(time_scale=1))
        self.assertGreaterEqual(response.revision, 2)
        await self.until(lambda: self.client.connected.is_set() and self.client.guard.session != previous)
        await self.arm()
        with self.assertRaises(grpc.aio.AioRpcError):
            await self.api.Reset(mpb.ResetRequest(time_scale=1))

    async def test_navigation_uses_model_pose_and_unknown_routes_are_rejected(self):
        await self.arm()
        result = await self.invoke('Robot.Navigation.GoTo', {'X': pb.Value(float64_value=.1), 'Y': pb.Value(float64_value=0)})
        self.assertEqual(result[-1].phase, pb.SUCCEEDED)
        self.assertGreater(self.backend.x, .055)
        result = await self.invoke('Robot.Navigation.FollowRoute', {'RouteId': pb.Value(string_value='missing')})
        self.assertEqual(result[-1].phase, pb.REJECTED)

    async def test_local_watchdogs_stop_model_even_when_broker_sweeper_is_stalled(self):
        await self.arm()
        await self.bus.SetTarget(self.target(1))
        await self.until(lambda: self.backend.v > 0)
        self.renew_task.cancel()
        await asyncio.gather(self.renew_task, return_exceptions=True)
        self.renew_task = None
        self.broker.sweeper.cancel()
        await asyncio.gather(self.broker.sweeper, return_exceptions=True)
        self.broker.sweeper = None
        old_guard = self.client.guard
        # Do not call Get here: Get itself sweeps broker state. Observe the
        # actual model to isolate provider-local watchdog behavior.
        await self.until(lambda: self.backend.v == 0, timeout=.4)
        await self.until(lambda: self.backend.stop_latched, timeout=.4)
        self.assertEqual(old_guard.lease_deadline, 0)
        self.assertGreaterEqual(old_guard.invalid_through, self.lease.fence)
        await self.until(lambda: self.broker.lease is None)
        await self.until(lambda: self.client.guard.session != old_guard.session and self.client.connected.is_set())
        old = self.lease.fence
        self.broker.provider.control_queue.put_nowait(pb.Dispatch(kind=pb.LEASE_UPDATE,
            fence=old, broker_epoch=self.broker.epoch, provider_session=old_guard.session,
            deadline_monotonic_ns=time.monotonic_ns()+1_000_000_000))
        await asyncio.sleep(.05)
        self.assertEqual(self.client.guard.lease_deadline, 0, 'late renewal cannot resurrect revoked authority')
        self.assertEqual(self.backend.v, 0)

    async def test_old_lease_revocation_cannot_zero_a_new_lease_after_actual_wire_delivery(self):
        await self.arm()
        old_fence = self.lease.fence
        self.renew_task.cancel()
        await asyncio.gather(self.renew_task, return_exceptions=True)
        self.renew_task = None
        await self.bus.ReleaseLease(self.lease)
        await self.until(lambda: self.client.guard.lease_deadline == 0)
        await self.acquire()
        self.assertGreater(self.lease.fence, old_fence)
        self.assertEqual((await self.invoke('Robot.Safety.ResetStop'))[-1].phase, pb.SUCCEEDED)
        self.assertEqual((await self.invoke('Robot.Safety.Arm'))[-1].phase, pb.SUCCEEDED)
        await self.bus.SetTarget(self.target(1, linear=.15))
        await self.until(lambda: self.backend.v == .15)
        self.broker.provider.safety_queue.put_nowait(pb.Dispatch(kind=pb.LEASE_REVOKED,
            fence=old_fence, broker_epoch=self.broker.epoch, provider_session=self.client.guard.session))
        await asyncio.sleep(.05)
        self.assertEqual(self.backend.v, .15)
        self.assertFalse(self.backend.stop_latched)

    async def test_configured_route_runs_through_model_and_returns_to_manual(self):
        self.backend.profile['routes']['unit-route'] = [[.1, 0], [0, 0]]
        await self.reconnect_after_profile_fixture_change()
        await self.arm()
        result = await self.invoke('Robot.Navigation.FollowRoute', {'RouteId': pb.Value(string_value='unit-route')})
        self.assertEqual(result[-1].phase, pb.SUCCEEDED)
        self.assertTrue(result[-1].physical_confirmed)
        self.assertLessEqual(abs(self.backend.x), .041)
        self.assertEqual(self.backend.mode, 'MANUAL')

    async def test_stop_during_motion_waits_for_recovery_before_confirming_model_stop(self):
        self.backend.profile['motionDurationSeconds']['BOW'] = .5
        await self.reconnect_after_profile_fixture_change()
        await self.arm()
        call = self.bus.Invoke(self.invocation('Robot.Motion.Perform', {'Name': pb.Value(string_value='BOW')}))
        self.calls.append(call)
        await call.read()
        await self.wait_value('Robot.Safety.Mode', lambda sample: sample.value.string_value == 'MOTION')
        reply = await self.bus.Stop(pb.StopRequest(reason='stop active mock motion'))
        self.assertTrue(reply.dispatched and reply.robot_confirmed)
        self.assertFalse(self.backend.motion_active)
        self.assertEqual(self.backend.mode, 'SAFE_STOP')
        await self.until(lambda: not self.broker.draining)

    async def test_long_recovery_is_not_falsely_confirmed_by_initial_stop_reply(self):
        self.backend.profile['motionDurationSeconds']['BOW'] = .7
        self.backend.profile['recoverySeconds'] = .3
        await self.reconnect_after_profile_fixture_change()
        await self.arm()
        call = self.bus.Invoke(self.invocation('Robot.Motion.Perform', {'Name': pb.Value(string_value='BOW')}))
        self.calls.append(call)
        await call.read()
        await self.wait_value('Robot.Safety.Mode', lambda sample: sample.value.string_value == 'MOTION')
        reply = await self.bus.Stop(pb.StopRequest(reason='long mock recovery'))
        self.assertTrue(reply.dispatched)
        self.assertFalse(reply.robot_confirmed)
        await self.until(lambda: not self.backend.motion_active)
        await self.wait_value('Robot.Safety.Stop.Status.Phase', lambda sample: sample.value.string_value == 'SUCCEEDED')

import asyncio
import json
from pathlib import Path
import tempfile
import time
import uuid

import grpc
from commands import TERMINAL
from protobus.v1 import protobus_pb2 as pb
from test_broker_control import ControlFixture


class CommandFixture(ControlFixture):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.lease = await self.acquire(ttl=2000)

    def request(self, path='Robot.Motion.Perform', timeout=1000, key=None, args=None):
        if args is None:
            args = {'Name': pb.Value(string_value='BOW')} if path == 'Robot.Motion.Perform' else {}
        return pb.Invocation(lease=self.lease, path=path, args=pb.Object(fields=args),
                             timeout_ms=timeout, idempotency_key=key or str(uuid.uuid4()))

    async def begin(self, request=None):
        call = self.bus.Invoke(request or self.request())
        self.calls.append(call)
        first = await asyncio.wait_for(call.read(), 2)
        self.assertEqual(first.phase, pb.PENDING, first)
        dispatch = await self.next_kind(self.control, pb.INVOKE)
        self.assertEqual(dispatch.execution_id, first.execution_id)
        return call, dispatch

    async def feedback(self, dispatch, phase, confirmed=False, **changes):
        fields = dict(execution_id=dispatch.execution_id, path=dispatch.path, phase=phase,
                      provider_session=self.hello.session, physical_confirmed=confirmed)
        fields.update(changes)
        return await self.packet(pb.ProviderPacket(command=pb.CommandUpdate(**fields)))

    async def rejected(self, request, code):
        call = self.bus.Invoke(request)
        self.calls.append(call)
        result = await asyncio.wait_for(call.read(), 2)
        self.assertEqual(result.phase, pb.REJECTED)
        self.assertIn(code, result.reason)
        return result

    async def finish_success(self, call, dispatch):
        self.assertTrue((await self.feedback(dispatch, pb.ACCEPTED)).ok)
        self.assertEqual((await call.read()).phase, pb.ACCEPTED)
        self.assertTrue((await self.feedback(dispatch, pb.SUCCEEDED, True)).ok)
        result = await call.read()
        self.assertEqual(result.phase, pb.SUCCEEDED)
        self.assertTrue(result.physical_confirmed)
        return result


class CommandLifecycleTests(CommandFixture):
    async def test_full_lifecycle_requires_actual_provider_result_and_updates_status(self):
        call, dispatch = await self.begin()
        self.assertTrue((await self.feedback(dispatch, pb.ACCEPTED)).ok)
        self.assertEqual((await call.read()).phase, pb.ACCEPTED)
        self.assertTrue((await self.feedback(dispatch, pb.RUNNING)).ok)
        self.assertEqual((await call.read()).phase, pb.RUNNING)
        bad = await self.feedback(dispatch, pb.SUCCEEDED, False)
        self.assertFalse(bad.ok)
        self.assertEqual(bad.code, 'PB_BAD_TRANSITION')
        self.assertTrue((await self.feedback(dispatch, pb.SUCCEEDED, True)).ok)
        done = await call.read()
        self.assertEqual(done.phase, pb.SUCCEEDED)
        self.assertTrue(done.physical_confirmed)
        self.assertEqual(await call.read(), grpc.aio.EOF)
        self.assertIsNone(self.broker.active_execution)
        self.assertFalse(self.broker.draining)
        status = await self.bus.Get(self.query('Robot.Motion.Perform.Status.Phase'))
        self.assertEqual(status.samples[0].value.string_value, 'SUCCEEDED')
        await asyncio.sleep(.12)
        status = await self.bus.Get(self.query('Robot.Motion.Perform.Status.Phase'))
        self.assertEqual(status.samples[0].quality, pb.OK, 'broker-known state is not a stale remote measurement')

    async def test_bad_transition_and_wrong_feedback_identity_do_not_advance_state(self):
        call, dispatch = await self.begin()
        for changes, code in [({'phase': pb.RUNNING}, 'PB_BAD_TRANSITION'),
                              ({'phase': pb.ACCEPTED, 'provider_session': 'old'}, 'PB_PROVIDER_MISMATCH'),
                              ({'phase': pb.ACCEPTED, 'execution_id': 'unknown'}, 'PB_PROVIDER_MISMATCH'),
                              ({'phase': pb.ACCEPTED, 'physical_confirmed': True}, 'PB_BAD_TRANSITION')]:
            phase = changes.pop('phase')
            confirmed = changes.pop('physical_confirmed', False)
            ack = await self.feedback(dispatch, phase, confirmed, **changes)
            self.assertFalse(ack.ok)
            self.assertEqual(ack.code, code)
        self.assertEqual(self.broker.executions[dispatch.execution_id].phase, pb.PENDING)
        await self.finish_success(call, dispatch)

    async def test_timeout_cancels_and_late_success_cannot_rewrite_terminal_result(self):
        call, dispatch = await self.begin(self.request(timeout=80))
        result = await asyncio.wait_for(call.read(), .3)
        self.assertEqual(result.phase, pb.TIMED_OUT)
        self.assertFalse(result.physical_confirmed)
        cancel = await self.next_kind(self.safety, pb.CANCEL)
        self.assertEqual(cancel.execution_id, dispatch.execution_id)
        await self.rejected(self.request(), 'PB_RESOURCE_BUSY')
        self.assertTrue((await self.feedback(dispatch, pb.SUCCEEDED, True)).ok)
        execution = self.broker.executions[dispatch.execution_id]
        self.assertEqual(execution.phase, pb.TIMED_OUT)
        self.assertEqual(execution.history[-1].phase, pb.TIMED_OUT)
        self.assertTrue(execution.released)
        next_call, next_dispatch = await self.begin()
        await self.finish_success(next_call, next_dispatch)

    async def test_cancel_waits_for_provider_confirmation_and_is_idempotent(self):
        call, dispatch = await self.begin()
        await self.assert_rpc_error(self.bus.Cancel(pb.CancelRequest(lease=self.lease,
            execution_id='unknown')), 'PB_INVALID_VALUE')
        await self.feedback(dispatch, pb.ACCEPTED)
        await call.read()
        self.assertTrue((await self.bus.Cancel(pb.CancelRequest(lease=self.lease,
            execution_id=dispatch.execution_id))).ok)
        cancel = await self.next_kind(self.safety, pb.CANCEL)
        self.assertEqual(cancel.execution_id, dispatch.execution_id)
        self.assertTrue((await self.bus.Cancel(pb.CancelRequest(lease=self.lease,
            execution_id=dispatch.execution_id))).ok)
        pending = asyncio.create_task(call.read())
        await asyncio.sleep(.03)
        self.assertFalse(pending.done(), 'cancel request is not physical cancellation')
        await self.feedback(dispatch, pb.CANCELLED, True)
        self.assertEqual((await pending).phase, pb.CANCELLED)
        self.assertFalse(self.broker.draining)

    async def test_disconnected_invoke_stream_cancels_work_without_replay(self):
        call, dispatch = await self.begin()
        call.cancel()
        cancel = await self.next_kind(self.safety, pb.CANCEL, timeout=.5)
        self.assertEqual(cancel.execution_id, dispatch.execution_id)
        self.assertEqual(self.broker.executions[dispatch.execution_id].phase, pb.CANCELLED)

    async def test_duplicate_accepted_invocation_does_not_dispatch_again(self):
        request = self.request(key='same-operation')
        first, dispatch = await self.begin(request)
        second = self.bus.Invoke(request)
        self.calls.append(second)
        self.assertEqual((await second.read()).execution_id, dispatch.execution_id)
        ordinary = asyncio.create_task(self.control.read())
        await asyncio.sleep(.03)
        self.assertFalse(ordinary.done(), 'duplicate must not issue another command')
        await self.finish_success(first, dispatch)
        self.assertEqual((await second.read()).phase, pb.ACCEPTED)
        self.assertEqual((await second.read()).phase, pb.SUCCEEDED)
        changed = self.request(key='same-operation', timeout=900)
        await self.rejected(changed, 'PB_REPLAY')
        ordinary.cancel()
        await asyncio.gather(ordinary, return_exceptions=True)

    async def test_hold_and_command_resources_exclude_each_other(self):
        await self.bus.SetTarget(self.target(self.lease))
        await self.next_kind(self.control, pb.SET_TARGET)
        await self.rejected(self.request(), 'PB_RESOURCE_BUSY')
        await self.bus.SetTarget(self.target(self.lease, value=0, sequence=2, release=True))
        safe=await self.next_kind(self.safety, pb.SAFE_VALUE)
        await self.feedback(safe,pb.SUCCEEDED,True,target_sequence=safe.sequence)
        call, dispatch = await self.begin()
        await self.assert_rpc_error(self.bus.SetTarget(self.target(self.lease, sequence=3)), 'PB_RESOURCE_BUSY')
        await self.finish_success(call, dispatch)

    async def test_invalid_args_timeout_kind_and_missing_owner_are_rejected(self):
        for request, code in [
            (self.request(args={'Name': pb.Value(string_value='INVALID')}), 'PB_INVALID_VALUE'),
            (self.request(args={}), 'PB_INVALID_VALUE'),
            (self.request(timeout=1001), 'PB_INVALID_VALUE'),
            (self.request(path='Robot.Signal.Speed'), 'PB_INVALID_KIND'),
            (self.request(path='Robot.Unknown'), 'PB_INVALID_PATH')]:
            await self.rejected(request, code)
        self.assertIsNone(self.broker.active_execution)

    async def test_provider_rejection_failure_and_confirmed_terminal_immutability(self):
        call, dispatch = await self.begin()
        self.assertTrue((await self.feedback(dispatch, pb.REJECTED, True)).ok)
        rejected = await call.read()
        self.assertEqual(rejected.phase, pb.REJECTED)
        self.assertFalse(self.broker.draining)
        contradiction = await self.feedback(dispatch, pb.SUCCEEDED, True)
        self.assertFalse(contradiction.ok)
        self.assertEqual(contradiction.code, 'PB_BAD_TRANSITION')
        call, dispatch = await self.begin()
        await self.feedback(dispatch, pb.ACCEPTED)
        await call.read()
        self.assertTrue((await self.feedback(dispatch, pb.FAILED, True)).ok)
        self.assertEqual((await call.read()).phase, pb.FAILED)
        self.assertIsNone(self.broker.active_execution)

    async def test_provider_offline_rejects_invocation_instead_of_dispatching(self):
        self.provider.cancel()
        for _ in range(30):
            if self.broker.provider is None:
                break
            await asyncio.sleep(.01)
        await self.rejected(self.request(), 'PB_PROVIDER_OFFLINE')


class StopTests(CommandFixture):
    async def test_nonowner_stop_revokes_target_and_separates_receipt_from_confirmation(self):
        await self.bus.SetTarget(self.target(self.lease))
        await self.next_kind(self.control, pb.SET_TARGET)
        stop_task = asyncio.ensure_future(self.bus.Stop(pb.StopRequest(reason='operator')))
        dispatch = await self.next_kind(self.safety, pb.STOP)
        self.assertIsNone(self.broker.lease)
        self.assertFalse(self.broker.targets)
        await self.feedback(dispatch, pb.ACCEPTED)
        self.assertFalse(stop_task.done())
        await self.feedback(dispatch, pb.SUCCEEDED, True)
        result = await stop_task
        self.assertTrue(result.requested and result.dispatched and result.robot_confirmed)

    async def test_ack_without_physical_feedback_never_reports_confirmed_and_requires_reset(self):
        stop_task = asyncio.ensure_future(self.bus.Stop(pb.StopRequest(reason='operator')))
        dispatch = await self.next_kind(self.safety, pb.STOP)
        await self.feedback(dispatch, pb.ACCEPTED)
        reply = await stop_task
        self.assertTrue(reply.requested and reply.dispatched)
        self.assertFalse(reply.robot_confirmed)
        self.lease = await self.acquire(ttl=2000)
        await self.rejected(self.request(), 'PB_STOPPED')
        reset, reset_dispatch = await self.begin(self.request(path='Robot.Safety.ResetStop'))
        await self.finish_success(reset, reset_dispatch)
        self.assertFalse(self.broker.stop_latched)

    async def test_offline_stop_does_not_fabricate_provider_or_robot_confirmation(self):
        self.provider.cancel()
        for _ in range(30):
            if self.broker.provider is None:
                break
            await asyncio.sleep(.01)
        result = await self.bus.Stop(pb.StopRequest(reason='offline'))
        self.assertTrue(result.requested)
        self.assertFalse(result.dispatched or result.robot_confirmed)

    async def test_stop_terminates_command_but_keeps_unconfirmed_body_quarantined(self):
        call, command = await self.begin()
        stop_task = asyncio.ensure_future(self.bus.Stop(pb.StopRequest(reason='interrupt')))
        stop = await self.next_kind(self.safety, pb.STOP)
        terminal = await call.read()
        self.assertIn(terminal.phase, TERMINAL)
        self.assertFalse(terminal.physical_confirmed)
        self.assertIn(command.execution_id, self.broker.draining)
        await self.feedback(stop, pb.SUCCEEDED, True)
        self.assertTrue((await stop_task).robot_confirmed)
        await self.feedback(command, pb.CANCELLED, True)
        self.assertNotIn(command.execution_id, self.broker.draining)

    async def test_stop_bypasses_one_thousand_unread_ordinary_dispatches(self):
        # Normal, valid lease renewals produce 1,000 Control dispatches. The
        # application deliberately does not read any of them before STOP.
        for _ in range(1000):
            self.lease = await self.bus.RenewLease(self.lease)
        start = time.monotonic()
        stop_task = asyncio.ensure_future(self.bus.Stop(pb.StopRequest(reason='saturated reader')))
        stop = await self.next_kind(self.safety, pb.STOP, timeout=.5)
        latency = time.monotonic()-start
        self.assertLess(latency, .5)
        await self.feedback(stop, pb.SUCCEEDED, True)
        self.assertTrue((await stop_task).robot_confirmed)
        print(f'Production broker STOP receipt with 1000 unread Control dispatches: {latency*1000:.3f} ms')


class AuditTests(CommandFixture):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name)/'audit.jsonl'
        self.broker.audit.path = self.path
        await self.broker.audit.start()

    async def asyncTearDown(self):
        await super().asyncTearDown()
        self.directory.cleanup()

    async def test_real_jsonl_phase_target_stop_records_and_no_lease_token(self):
        await self.bus.RenewLease(self.lease)
        await self.next_kind(self.control, pb.LEASE_UPDATE)
        await self.bus.SetTarget(self.target(self.lease))
        await self.next_kind(self.control, pb.SET_TARGET)
        await self.bus.SetTarget(self.target(self.lease, value=0, sequence=2, release=True))
        safe=await self.next_kind(self.safety, pb.SAFE_VALUE)
        await self.feedback(safe,pb.SUCCEEDED,True,target_sequence=safe.sequence)
        call, command = await self.begin()
        await self.finish_success(call, command)
        stop_task = asyncio.ensure_future(self.bus.Stop(pb.StopRequest(reason='audit test')))
        stop = await self.next_kind(self.safety, pb.STOP)
        await self.feedback(stop, pb.SUCCEEDED, True)
        await stop_task
        await asyncio.wait_for(self.broker.audit.queue.join(), 2)
        text = self.path.read_text()
        events = [json.loads(line) for line in text.splitlines()]
        self.assertTrue({'target_set', 'target_released', 'command_phase', 'stop', 'stop_feedback'}
                        <= {row['event'] for row in events})
        self.assertNotIn(self.lease.token, text)
        for row in events:
            self.assertIn('time_ns', row)
            self.assertIn('broker_epoch', row)
        target_row = next(row for row in events if row['event'] == 'target_set')
        self.assertEqual(target_row['value']['fields']['LinearX']['float64Value'], .2)
        invocation_row = next(row for row in events if row['event'] == 'command_phase' and row['phase'] == 'PENDING')
        self.assertEqual(invocation_row['args']['fields']['Name']['stringValue'], 'BOW')
        self.assertEqual(invocation_row['client_id'], 'app-1')

    async def test_real_write_failure_revokes_motion_but_stop_remains_available(self):
        self.path.touch()
        self.path.chmod(0o400)
        await self.bus.RenewLease(self.lease)
        stop = await self.next_kind(self.safety, pb.STOP)
        self.assertEqual(stop.reason, 'PB_AUDIT_FAILED')
        self.assertTrue(self.broker.audit.failed)
        self.assertIsNone(self.broker.lease)
        self.assertFalse((await self.bus.Describe(pb.Empty())).audit_ok)
        await self.assert_rpc_error(self.bus.AcquireLease(pb.LeaseRequest(client_id='retry',
            catalog_hash=self.catalog['catalogHash'], ttl_ms=1000)), 'PB_AUDIT_FAILED')
        stop_task = asyncio.ensure_future(self.bus.Stop(pb.StopRequest(reason='still available')))
        second = await self.next_kind(self.safety, pb.STOP)
        await self.feedback(second, pb.SUCCEEDED, True)
        self.assertTrue((await stop_task).robot_confirmed)

    async def fill_stalled_audit(self):
        await self.broker.audit.queue.join()
        self.broker.audit.task.cancel()
        await asyncio.gather(self.broker.audit.task, return_exceptions=True)
        self.broker.audit.task = None
        # Deterministic queue-overflow injection; real filesystem failure is a
        # separate test above. Do not claim this is a physical disk stall.
        for _ in range(self.broker.audit.queue.maxsize):
            self.broker.audit.queue.put_nowait({'event': 'stalled writer fixture'})

    async def test_audit_overflow_cannot_enqueue_command_after_synchronous_stop(self):
        await self.fill_stalled_audit()
        call = self.bus.Invoke(self.request())
        self.calls.append(call)
        pending = await call.read()
        failed = await call.read()
        self.assertEqual(pending.phase, pb.PENDING)
        self.assertIn(failed.phase, TERMINAL)
        stop = await self.next_kind(self.safety, pb.STOP)
        self.assertEqual(stop.reason, 'PB_AUDIT_FAILED')
        self.assertIsNone(self.broker.lease)
        self.assertFalse(any(item.kind == pb.INVOKE for item in list(self.broker.provider.control_queue._queue)))

    async def test_audit_overflow_during_acquire_returns_explicit_error_not_internal_failure(self):
        await self.bus.ReleaseLease(self.lease)
        await self.next_kind(self.safety, pb.LEASE_REVOKED)
        await self.fill_stalled_audit()
        await self.assert_rpc_error(self.bus.AcquireLease(pb.LeaseRequest(client_id='new',
            catalog_hash=self.catalog['catalogHash'], ttl_ms=1000)), 'PB_AUDIT_FAILED')
        stop = await self.next_kind(self.safety, pb.STOP)
        self.assertEqual(stop.reason, 'PB_AUDIT_FAILED')
        self.assertIsNone(self.broker.lease)

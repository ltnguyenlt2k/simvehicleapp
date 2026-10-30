import asyncio

from protobus.v1 import protobus_pb2 as pb
from test_broker_commands import CommandFixture


class ExecutionInspectionTests(CommandFixture):
    def inspection(self,identity,**changes):
        values=dict(catalog_hash=self.broker.catalog_hash,broker_epoch=self.broker.epoch,execution_id=identity)
        values.update(changes)
        return self.bus.InspectExecution(pb.ExecutionQuery(**values))

    async def test_pending_and_confirmed_identity_over_actual_grpc(self):
        call,dispatch=await self.begin()
        before=await self.inspection(dispatch.execution_id)
        self.assertEqual(before.logical_phase,pb.PENDING)
        self.assertFalse(before.physical_released)
        self.assertEqual(before.provider_session,self.hello.session)
        self.assertEqual(before.fence,self.lease.fence)
        await self.finish_success(call,dispatch)
        after=await self.inspection(dispatch.execution_id)
        self.assertEqual(after.logical_phase,pb.SUCCEEDED)
        self.assertTrue(after.physical_released)
        self.assertEqual(after.physical_phase,pb.SUCCEEDED)

    async def test_late_physical_release_is_visible_without_rewriting_timeout(self):
        call,dispatch=await self.begin(self.request(timeout=80))
        terminal=await asyncio.wait_for(call.read(),.4)
        self.assertEqual(terminal.phase,pb.TIMED_OUT)
        before=await self.inspection(dispatch.execution_id)
        self.assertFalse(before.physical_released)
        self.assertTrue((await self.feedback(dispatch,pb.CANCELLED,True)).ok)
        after=await self.inspection(dispatch.execution_id)
        self.assertEqual(after.logical_phase,pb.TIMED_OUT)
        self.assertEqual(after.physical_phase,pb.CANCELLED)
        self.assertTrue(after.physical_released)
        self.assertEqual(self.broker.executions[dispatch.execution_id].history[-1].phase,pb.TIMED_OUT)
        self.assertTrue((await self.feedback(dispatch,pb.CANCELLED,True)).ok,'same physical release is idempotent')
        self.assertFalse((await self.feedback(dispatch,pb.SUCCEEDED,True)).ok,'physical terminal is immutable too')

    async def test_stop_receipt_id_queries_later_confirmation_without_lease(self):
        stop_task=asyncio.ensure_future(self.bus.Stop(pb.StopRequest(reason='inspect delayed STOP')))
        dispatch=await self.next_kind(self.safety,pb.STOP)
        await self.feedback(dispatch,pb.ACCEPTED)
        receipt=await stop_task
        self.assertEqual(receipt.execution_id,dispatch.execution_id)
        self.assertEqual(receipt.broker_epoch,self.broker.epoch)
        self.assertEqual(receipt.provider_session,self.hello.session)
        self.assertFalse(receipt.robot_confirmed)
        self.assertIsNone(self.broker.lease)
        self.assertFalse((await self.inspection(receipt.execution_id)).physical_released)
        await self.feedback(dispatch,pb.SUCCEEDED,True)
        result=await self.inspection(receipt.execution_id)
        self.assertTrue(result.physical_released)
        self.assertEqual(result.path,'Robot.Safety.Stop')
        self.assertIsNone(self.broker.lease,'read-only inspection cannot reacquire authority')

    async def test_inspection_rejects_unknown_wrong_catalog_epoch_and_oversize(self):
        call,dispatch=await self.begin()
        for identity,changes,code in [('unknown',{},'PB_INVALID_VALUE'),
            (dispatch.execution_id,{'catalog_hash':'wrong'},'PB_CATALOG_MISMATCH'),
            (dispatch.execution_id,{'broker_epoch':'old'},'PB_REPLAY'),
            ('x'*129,{},'PB_INVALID_VALUE')]:
            await self.assert_rpc_error(self.inspection(identity,**changes),code)
        self.assertEqual(self.broker.active_execution,dispatch.execution_id)
        await self.finish_success(call,dispatch)

    async def test_reset_resource_clear_cannot_fabricate_old_physical_result(self):
        call,dispatch=await self.begin(self.request(timeout=80))
        self.assertEqual((await asyncio.wait_for(call.read(),.4)).phase,pb.TIMED_OUT)
        reset,reset_dispatch=await self.begin(self.request(path='Robot.Safety.ResetStop'))
        await self.finish_success(reset,reset_dispatch)
        self.assertTrue(self.broker.executions[dispatch.execution_id].released,'recovery clears resource quarantine')
        self.assertFalse((await self.inspection(dispatch.execution_id)).physical_released,
            'resource quarantine clear is not correlated physical terminal feedback')

    async def test_descriptor_identifies_current_provider_session(self):
        descriptor=await self.bus.Describe(pb.Empty())
        self.assertEqual(descriptor.provider_session,self.hello.session)
        self.assertEqual(descriptor.protocol_version,'1.5')

from protobus.v1 import protobus_pb2 as pb
from test_broker_commands import CommandFixture


class HoldTransportTests(CommandFixture):
    async def inspect(self,identity):
        return await self.bus.InspectExecution(pb.ExecutionQuery(catalog_hash=self.broker.catalog_hash,
            broker_epoch=self.broker.epoch,execution_id=identity))

    async def test_actual_socket_receipt_admission_and_release_have_distinct_proofs(self):
        receipt=await self.bus.SetTarget(self.target(self.lease))
        target=await self.next_kind(self.control,pb.SET_TARGET)
        self.assertEqual(receipt.operation_id,target.execution_id)
        state=await self.inspect(receipt.operation_id)
        self.assertEqual(state.logical_phase,pb.PENDING);self.assertFalse(state.physical_released)
        self.assertEqual(state.owner_id,'hold-1');self.assertEqual(state.accepted_sequence,0)
        self.assertTrue((await self.feedback(target,pb.RUNNING,target_sequence=1)).ok)
        state=await self.inspect(receipt.operation_id)
        self.assertEqual(state.accepted_sequence,1);self.assertFalse(state.physical_released)
        release=await self.bus.SetTarget(self.target(self.lease,value=0,sequence=2,release=True))
        safe=await self.next_kind(self.safety,pb.SAFE_VALUE)
        self.assertEqual(release.operation_id,receipt.operation_id)
        self.assertTrue((await self.inspect(release.operation_id)).release_requested)
        await self.rejected(self.request(),'PB_RESOURCE_BUSY')
        bad=await self.feedback(safe,pb.SUCCEEDED,True,target_sequence=1)
        self.assertFalse(bad.ok)
        self.assertFalse((await self.inspect(release.operation_id)).physical_released)
        self.assertTrue((await self.feedback(safe,pb.SUCCEEDED,True,target_sequence=2)).ok)
        state=await self.inspect(release.operation_id)
        self.assertTrue(state.physical_released);self.assertEqual(state.logical_phase,pb.SUCCEEDED)
        call,command=await self.begin();await self.finish_success(call,command)

    async def test_release_retry_and_late_admission_cannot_reopen_completed_hold(self):
        receipt=await self.bus.SetTarget(self.target(self.lease))
        original=await self.next_kind(self.control,pb.SET_TARGET)
        await self.bus.SetTarget(self.target(self.lease,value=0,sequence=2,release=True))
        safe=await self.next_kind(self.safety,pb.SAFE_VALUE)
        retry=await self.bus.SetTarget(self.target(self.lease,value=0,sequence=3,release=True))
        self.assertEqual(retry.operation_id,receipt.operation_id)
        self.assertTrue((await self.feedback(safe,pb.SUCCEEDED,True,target_sequence=2)).ok)
        self.assertTrue((await self.feedback(original,pb.RUNNING,target_sequence=1)).ok)
        state=await self.inspect(receipt.operation_id)
        self.assertEqual(state.logical_phase,pb.SUCCEEDED);self.assertEqual(state.last_sequence,3)
        await self.assert_rpc_error(self.bus.SetTarget(self.target(self.lease,sequence=4)),'PB_REPLAY')

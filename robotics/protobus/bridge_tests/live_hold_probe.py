"""Actual broker/ROS/physics Hold admission, safe release and body handover."""
import asyncio
import json
import math
import os
import time
import uuid
import grpc
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc


async def main():
    async with grpc.aio.insecure_channel(os.environ.get('SR_TEST_BUS','broker:55600')) as channel:
        bus=rpc.BusStub(channel);lease=None;renewal=None;operations=[]
        async def wait(function,timeout=10):
            end=time.monotonic()+timeout
            while time.monotonic()<end:
                result=await function()
                if result:return result
                await asyncio.sleep(.02)
            raise AssertionError('actual Hold condition timed out')
        async def connected():
            value=await bus.Describe(pb.Empty(),timeout=2)
            return value if value.provider_online and value.target_context.kind==pb.ROS_SIM else None
        descriptor=await wait(connected,20)
        assert descriptor.protocol_version=='1.6' and descriptor.target_context.remote_arm_authorized
        async def samples():
            batch=await bus.Get(pb.Query(catalog_hash=descriptor.catalog_hash),timeout=2)
            assert batch.broker_epoch==descriptor.broker_epoch
            assert batch.provider_session==descriptor.provider_session
            return {item.path:item for item in batch.samples if item.quality==pb.OK}
        async def inspect(identity):
            return await bus.InspectExecution(pb.ExecutionQuery(catalog_hash=descriptor.catalog_hash,
                broker_epoch=descriptor.broker_epoch,execution_id=identity),timeout=2)
        async def invoke(path):
            args={'Name':pb.Value(string_value='BOW')} if path=='Robot.Motion.Perform' else {}
            updates=[item async for item in bus.Invoke(pb.Invocation(lease=lease,path=path,
                args=pb.Object(fields=args),idempotency_key=str(uuid.uuid4())))]
            assert updates and updates[-1].phase==pb.SUCCEEDED and updates[-1].physical_confirmed,updates
            operations.append({'path':path,'executionId':updates[-1].execution_id,
                'phases':[pb.Phase.Name(item.phase) for item in updates],'physicalConfirmed':True})
            print(json.dumps({'event':'actual_command_complete','path':path}),flush=True)
        async def target(sequence,value,release=False):
            return await bus.SetTarget(pb.Target(lease=lease,path='Robot.Motion.Velocity',owner_id='actual-hold-'+run_id,
                sequence=sequence,release=release,value=pb.Object(fields={
                'LinearX':pb.Value(float64_value=value),'AngularZ':pb.Value(float64_value=0)})),timeout=2)
        run_id=str(uuid.uuid4())
        try:
            lease=await bus.AcquireLease(pb.LeaseRequest(client_id='actual-hold-probe',catalog_hash=descriptor.catalog_hash,ttl_ms=1000),timeout=2)
            async def renew():
                while True:await asyncio.sleep(.2);await bus.RenewLease(lease,timeout=1)
            renewal=asyncio.create_task(renew())
            initial=await samples()
            if initial['Robot.Safety.Mode'].value.string_value=='SAFE_STOP':await invoke('Robot.Safety.ResetStop')
            await invoke('Robot.Safety.Arm')
            initial=await samples();start=[initial['Robot.Pose.Position.'+axis].value.float64_value for axis in ('X','Y')]
            receipt=await target(1,.3)
            async def admitted():
                state=await inspect(receipt.operation_id)
                return state if state.accepted_sequence>=1 else None
            admission=await wait(admitted, .25)
            assert not admission.physical_released
            began=time.monotonic();sequence=1
            while time.monotonic()-began<.55:
                await asyncio.sleep(.05);sequence+=1
                fresh=await target(sequence,.3);assert fresh.operation_id==receipt.operation_id
            sequence+=1;released_at=time.monotonic();release=await target(sequence,0.,True)
            assert release.operation_id==receipt.operation_id
            async def confirmed():
                state=await inspect(release.operation_id)
                assert state.provider_session==descriptor.provider_session
                if state.logical_phase in (pb.FAILED,pb.TIMED_OUT,pb.CANCELLED,pb.REJECTED):raise AssertionError(state)
                return state if state.physical_released else None
            final=await wait(confirmed,3)
            assert final.logical_phase==pb.SUCCEEDED and final.physical_phase==pb.SUCCEEDED and final.release_requested
            release_seconds=time.monotonic()-released_at
            current=await samples()
            distance=math.hypot(*(current['Robot.Pose.Position.'+axis].value.float64_value-start[index] for index,axis in enumerate(('X','Y'))))
            assert distance>.04,('no measured physical displacement',distance)
            cancellation=None
            if os.environ.get('SR_TEST_CANCEL')=='true':
                running=asyncio.Event();cancel_updates=[]
                async def motion():
                    async for item in bus.Invoke(pb.Invocation(lease=lease,path='Robot.Motion.Perform',
                            args=pb.Object(fields={'Name':pb.Value(string_value='BOW')}),idempotency_key=str(uuid.uuid4()))):
                        cancel_updates.append(item)
                        if item.phase==pb.RUNNING:running.set()
                command=asyncio.create_task(motion())
                try:
                    await asyncio.wait_for(running.wait(),10)
                    identity=cancel_updates[-1].execution_id
                    ack=await bus.Cancel(pb.CancelRequest(lease=lease,execution_id=identity),timeout=2)
                    assert ack.ok
                    await asyncio.wait_for(command,10)
                    terminal=cancel_updates[-1]
                    assert terminal.phase==pb.CANCELLED and terminal.physical_confirmed,cancel_updates
                    recovered=await inspect(identity)
                    assert recovered.physical_released and recovered.physical_phase==pb.CANCELLED
                    async def manual_observed():
                        observed=await samples()
                        return observed if observed.get('Robot.Safety.Mode') and observed['Robot.Safety.Mode'].value.string_value=='MANUAL' else None
                    observed=await wait(manual_observed,.5)
                    cancellation={'executionId':identity,'phases':[pb.Phase.Name(item.phase) for item in cancel_updates],
                        'physicalConfirmed':True,'modeAfter':'MANUAL','rearmBetweenCommands':False}
                finally:
                    if not command.done():command.cancel()
                    await asyncio.gather(command,return_exceptions=True)
            await invoke('Robot.Motion.Perform')
            await invoke('Robot.Safety.Disarm')
            print(json.dumps(dict(passed=True,scope='actual ROS Hold admission/release and BOW handover only',
                protocol=descriptor.protocol_version,runId=run_id,holdExecutionId=receipt.operation_id,
                acceptedSequence=str(final.accepted_sequence),releaseSequence=str(final.last_sequence),
                physicalReleaseSeconds=release_seconds,odomDisplacementM=distance,operations=operations,
                normalCancellation=cancellation,
                brokerEpoch=descriptor.broker_epoch,providerSession=descriptor.provider_session)),flush=True)
        finally:
            if renewal:renewal.cancel();await asyncio.gather(renewal,return_exceptions=True)
            if lease:await bus.Stop(pb.StopRequest(reason='actual Hold probe cleanup'),timeout=3)


if __name__=='__main__':asyncio.run(main())

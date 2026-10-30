"""Actual broker safety connection interrupts an admitted physical BOW."""
import asyncio
import json
import uuid

import grpc
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc


async def run():
    async with grpc.aio.insecure_channel('broker:55600') as channel:
        bus=rpc.BusStub(channel)
        descriptor=await bus.Describe(pb.Empty(),timeout=3)
        assert descriptor.provider_online
        lease=await bus.AcquireLease(pb.LeaseRequest(client_id='actual-stop-motion',
            catalog_hash=descriptor.catalog_hash,ttl_ms=1000))
        async def renew():
            while True:
                await asyncio.sleep(.2)
                await bus.RenewLease(lease,timeout=2)
        renewal=asyncio.create_task(renew())
        async def invoke(path):
            updates=[item async for item in bus.Invoke(pb.Invocation(lease=lease,path=path,
                idempotency_key=str(uuid.uuid4())))]
            assert updates[-1].phase == pb.SUCCEEDED and updates[-1].physical_confirmed,updates
        try:
            snapshot=await bus.Get(pb.Query(catalog_hash=descriptor.catalog_hash),timeout=3)
            mode=next(item.value.string_value for item in snapshot.samples if item.path=='Robot.Safety.Mode')
            if mode=='SAFE_STOP': await invoke('Robot.Safety.ResetStop')
            await invoke('Robot.Safety.Arm')
            phases=[]
            stopped=False
            async for item in bus.Invoke(pb.Invocation(lease=lease,path='Robot.Motion.Perform',
                args=pb.Object(fields={'Name':pb.Value(string_value='BOW')}),idempotency_key=str(uuid.uuid4()))):
                phases.append(item)
                if item.phase == pb.RUNNING:
                    # Separate client connection as well as the provider's
                    # independent safety channel; no ordinary command response
                    # must complete before STOP can be received.
                    async with grpc.aio.insecure_channel('broker:55600',options=[('grpc.use_local_subchannel_pool',1)]) as safety:
                        receipt=await rpc.BusStub(safety).Stop(pb.StopRequest(reason='actual BOW interruption'),timeout=3)
                    stopped=True
                    print(json.dumps({'event':'stop_receipt','robot_confirmed':receipt.robot_confirmed}),flush=True)
            assert stopped,phases
            # Broker cancellation is immediate logical revocation. Physical
            # recovery completes later on the independent STOP status stream;
            # never mislabel the early cancellation as physical completion.
            assert phases[-1].phase==pb.CANCELLED,phases
            async def final_state():
                for _ in range(300):
                    result=await bus.Get(pb.Query(catalog_hash=descriptor.catalog_hash),timeout=2)
                    samples={item.path:item for item in result.samples}
                    mode=samples['Robot.Safety.Mode']
                    status=samples['Robot.Safety.Stop.Status.Phase']
                    if (mode.quality==pb.OK and mode.value.string_value=='SAFE_STOP'
                            and status.quality==pb.OK and status.value.string_value=='SUCCEEDED'): return
                    await asyncio.sleep(.05)
                raise AssertionError('actual SAFE_STOP was not observed')
            await final_state()
            print(json.dumps({'passed':True,'phases':[pb.Phase.Name(item.phase) for item in phases],
                'initial_cancellation_confirmed':phases[-1].physical_confirmed,
                'physical_stop_confirmed_after_recovery':True,'scope':'actual broker/ROS/physics STOP during BOW'}),flush=True)
        finally:
            renewal.cancel()
            await asyncio.gather(renewal,return_exceptions=True)
            await bus.Stop(pb.StopRequest(reason='actual interruption probe cleanup'),timeout=3)


if __name__=='__main__': asyncio.run(run())

"""Verify the production live profile rejects Arm under its tracked default."""
import asyncio
import json
import uuid
import grpc
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc


async def run():
    async with grpc.aio.insecure_channel('protobus-live:55600') as channel:
        bus=rpc.BusStub(channel)
        descriptor=await bus.Describe(pb.Empty(),timeout=3)
        assert descriptor.provider_online and descriptor.audit_ok
        lease=await bus.AcquireLease(pb.LeaseRequest(client_id='default-arm-policy-test',
            catalog_hash=descriptor.catalog_hash,ttl_ms=1000),timeout=3)
        try:
            updates=[item async for item in bus.Invoke(pb.Invocation(lease=lease,path='Robot.Safety.Arm',
                idempotency_key=str(uuid.uuid4())))]
            assert updates[-1].phase==pb.REJECTED and 'not authorized' in updates[-1].reason,updates
            snapshot=await bus.Get(pb.Query(catalog_hash=descriptor.catalog_hash,
                paths=['Robot.Safety.Mode','Robot.Safety.IsArmed']),timeout=3)
            samples={item.path:item for item in snapshot.samples}
            assert all(item.quality==pb.OK for item in samples.values())
            assert samples['Robot.Safety.Mode'].value.string_value in ('DISARMED','SAFE_STOP')
            assert not samples['Robot.Safety.IsArmed'].value.bool_value
            print(json.dumps({'passed':True,'default_remote_arm':'REJECTED','provider_online':True,
                'mode':samples['Robot.Safety.Mode'].value.string_value}),flush=True)
        finally:
            await bus.Stop(pb.StopRequest(reason='default Arm policy probe cleanup'),timeout=3)


if __name__=='__main__': asyncio.run(run())

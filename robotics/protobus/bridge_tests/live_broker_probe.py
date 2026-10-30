"""Actual broker -> provider -> ROS Brain -> physics increment probe."""
import asyncio
import json
import math
import time
import uuid
import grpc
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc


async def run():
    async with grpc.aio.insecure_channel('broker:55600') as channel:
        bus = rpc.BusStub(channel)
        async def wait(predicate, timeout=10):
            end = time.monotonic()+timeout
            while time.monotonic() < end:
                descriptor = await bus.Describe(pb.Empty(),timeout=2)
                data = await bus.Get(pb.Query(catalog_hash=descriptor.catalog_hash),timeout=2)
                values = {sample.path: sample.value for sample in data.samples if sample.quality == pb.OK}
                if predicate(values,descriptor): return values,descriptor
                await asyncio.sleep(.03)
            raise AssertionError('actual broker/ROS state timeout')
        values,descriptor = await wait(lambda v,d:d.provider_online and 'Robot.Safety.Mode' in v)
        lease = await bus.AcquireLease(pb.LeaseRequest(client_id='live-broker-probe',
            catalog_hash=descriptor.catalog_hash,ttl_ms=1000))
        async def renew():
            while True:
                await asyncio.sleep(.2)
                await bus.RenewLease(lease)
        renewal = asyncio.create_task(renew())
        phases = {}
        async def invoke(path,args=None):
            updates = []
            async for item in bus.Invoke(pb.Invocation(lease=lease,path=path,
                    args=pb.Object(fields=args or {}),idempotency_key=str(uuid.uuid4()))):
                updates.append(item)
            assert updates[-1].phase == pb.SUCCEEDED and updates[-1].physical_confirmed, updates
            phases[path+(':'+args['Name'].string_value if args and 'Name' in args else '')] = [pb.Phase.Name(item.phase) for item in updates]
            print(json.dumps({'event':'command_complete','path':path,'physical_confirmed':True}),flush=True)
        try:
            if values['Robot.Safety.Mode'].string_value == 'SAFE_STOP':
                await invoke('Robot.Safety.ResetStop')
            await invoke('Robot.Safety.Arm')
            values,_ = await wait(lambda v,d:v.get('Robot.Safety.Mode',pb.Value()).string_value == 'MANUAL')
            start = [values['Robot.Pose.Position.'+axis].float64_value for axis in ('X','Y')]
            for sequence in range(1,13):
                await bus.SetTarget(pb.Target(lease=lease,path='Robot.Motion.Velocity',owner_id='live-hold',
                    sequence=sequence,value=pb.Object(fields={'LinearX':pb.Value(float64_value=.3),'AngularZ':pb.Value(float64_value=0)})))
                await asyncio.sleep(.05)
            await bus.SetTarget(pb.Target(lease=lease,path='Robot.Motion.Velocity',owner_id='live-hold',
                sequence=13,release=True,value=pb.Object(fields={'LinearX':pb.Value(float64_value=0),'AngularZ':pb.Value(float64_value=0)})))
            values,_ = await wait(lambda v,d:abs(v.get('Robot.Velocity.Linear.X',pb.Value(float64_value=99)).float64_value)<.08)
            distance = math.hypot(values['Robot.Pose.Position.X'].float64_value-start[0],
                                   values['Robot.Pose.Position.Y'].float64_value-start[1])
            assert distance > .05, distance
            await invoke('Robot.Motion.Perform',{'Name':pb.Value(string_value='BOW')})
            await invoke('Robot.Motion.Perform',{'Name':pb.Value(string_value='LIFT_FRONT_LEFT')})
            await invoke('Robot.Motion.Perform',{'Name':pb.Value(string_value='JUMP')})
            # Fixed map-frame goal in the reset courtyard fixture. Do not treat
            # the odometry displacement measured above as map coordinates.
            await invoke('Robot.Navigation.GoTo',{'X':pb.Value(float64_value=.8),'Y':pb.Value(float64_value=0.)})
            stop = await bus.Stop(pb.StopRequest(reason='actual broker probe STOP'))
            await wait(lambda v,d:v.get('Robot.Safety.Mode',pb.Value()).string_value == 'SAFE_STOP')
            print(json.dumps(dict(passed=True,odom_displacement_m=distance,phases=phases,
                stop_initial_confirmed=stop.robot_confirmed,scope='actual broker/ROS/physics increment; not full M24 acceptance')),flush=True)
        finally:
            renewal.cancel()
            await asyncio.gather(renewal,return_exceptions=True)
            await bus.Stop(pb.StopRequest(reason='probe cleanup'))


if __name__ == '__main__':
    asyncio.run(run())

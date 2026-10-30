"""Actual ROS safe-output observer plus broker client for host process-fault tests."""
import asyncio
from collections import deque
import json
import sys
import threading
import time
import uuid

import grpc
import rclpy
from geometry_msgs.msg import TwistStamped
from rclpy.executors import SingleThreadedExecutor
from std_msgs.msg import String
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc


async def run():
    rclpy.init(args=[])
    node=rclpy.create_node('protobus_fault_observer_'+uuid.uuid4().hex[:8])
    safe=deque(maxlen=2000)
    brain={}
    def on_safe(message):
        safe.append((time.monotonic_ns(),message.twist.linear.x,message.twist.angular.z))
    def on_brain(message):
        nonlocal brain
        brain=json.loads(message.data)
    subscriptions=[node.create_subscription(TwistStamped,'/dog1/cmd_vel/safe',on_safe,10),
                   node.create_subscription(String,'/dog1/brain/state',on_brain,1)]
    executor=SingleThreadedExecutor()
    executor.add_node(node)
    thread=threading.Thread(target=executor.spin,daemon=True)
    thread.start()
    async def wait(predicate,timeout=10):
        end=time.monotonic()+timeout
        while time.monotonic()<end:
            if predicate(): return
            await asyncio.sleep(.01)
        raise AssertionError('actual fault observation timeout')
    renewal=holding=None
    try:
        await wait(lambda:brain.get('ready') and len(safe)>3)
        assert len(node.get_publishers_info_by_topic('/dog1/cmd_vel/safe'))==1
        assert all(pub.topic_name not in ('/dog1/control/request','/dog1/cmd_vel/safe','/dog1/motion/request')
                   for pub in node.publishers)
        async with grpc.aio.insecure_channel('broker:55600') as channel:
            bus=rpc.BusStub(channel)
            descriptor=await bus.Describe(pb.Empty(),timeout=2)
            assert descriptor.provider_online
            lease=await bus.AcquireLease(pb.LeaseRequest(client_id='actual-process-fault',
                catalog_hash=descriptor.catalog_hash,ttl_ms=1000),timeout=2)
            async def renew():
                while True:
                    await asyncio.sleep(.2)
                    await bus.RenewLease(lease,timeout=2)
            renewal=asyncio.create_task(renew())
            async def invoke(path):
                updates=[item async for item in bus.Invoke(pb.Invocation(lease=lease,path=path,
                    idempotency_key=str(uuid.uuid4())))]
                assert updates[-1].phase==pb.SUCCEEDED and updates[-1].physical_confirmed,updates
            if brain['mode']=='SAFE_STOP': await invoke('Robot.Safety.ResetStop')
            await invoke('Robot.Safety.Arm')
            async def hold():
                sequence=0
                while True:
                    sequence+=1
                    await bus.SetTarget(pb.Target(lease=lease,path='Robot.Motion.Velocity',owner_id='fault-hold',
                        sequence=sequence,value=pb.Object(fields={'LinearX':pb.Value(float64_value=.3),
                        'AngularZ':pb.Value(float64_value=0.)})),timeout=2)
                    await asyncio.sleep(.05)
            holding=asyncio.create_task(hold())
            await wait(lambda:safe and safe[-1][1]>.1)
            print(json.dumps({'event':'fault_ready','safe_linear':safe[-1][1]}),flush=True)
            marker=json.loads(await asyncio.to_thread(sys.stdin.readline))
            cutoff=marker['cutoff_monotonic_ns']
            await wait(lambda:any(t>=cutoff and x==0. and z==0. for t,x,z in safe),3)
            first=next(t for t,x,z in safe if t>=cutoff and x==0. and z==0.)
            latency=(first-cutoff)/1e9
            # This is safe command output latency, not physical stopping distance.
            assert latency<=.5,latency
            await asyncio.sleep(1.5)
            assert all(x==0. and z==0. for t,x,z in safe if t>=first)
            assert brain.get('mode')=='SAFE_STOP' and brain['authority']['owner'] is None,brain
            print(json.dumps({'passed':True,'safe_zero_seconds':latency,'no_auto_resume_seconds':1.5,
                'safe_writer_count':1,'physical_distance_claimed':False}),flush=True)
    finally:
        for task in (renewal,holding):
            if task: task.cancel()
        await asyncio.gather(*(task for task in (renewal,holding) if task),return_exceptions=True)
        executor.shutdown(timeout_sec=2)
        thread.join(2)
        node.destroy_node()
        rclpy.shutdown()


if __name__=='__main__': asyncio.run(run())

"""Read-only DDS/bus observer; host changes real SIM pause/source/epoch state."""
import argparse,asyncio,json,math,threading,time
from collections import deque
import grpc,rclpy
from rclpy.executors import SingleThreadedExecutor
from rclpy.qos import qos_profile_sensor_data
from rosgraph_msgs.msg import Clock
from std_msgs.msg import String
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc

async def run(case):
 rclpy.init();node=rclpy.create_node('capture_fault_observer_'+case)
 clocks=deque(maxlen=1000);brain={};sim={};images=deque(maxlen=200)
 def clock(message):clocks.append((time.monotonic(),message.clock.sec*10**9+message.clock.nanosec))
 def frame(kind,message):
  nonlocal brain,sim
  value=json.loads(message.data)
  if kind=='brain':brain=value
  elif kind=='sim':sim=value
  else:
   capture=value['capture_stamp'];images.append((time.monotonic(),capture['sec']*10**9+capture['nanosec'],value['issued_at_ns']))
 subscriptions=[node.create_subscription(Clock,'/clock',clock,qos_profile_sensor_data)]
 for kind,topic in [('brain','brain/state'),('sim','sim/state'),('image','perception/state')]:
  subscriptions.append(node.create_subscription(String,'/dog1/'+topic,lambda m,k=kind:frame(k,m),qos_profile_sensor_data))
 assert all(p.topic_name not in ('/dog1/control/request','/dog1/cmd_vel/safe','/dog1/motion/request') for p in node.publishers)
 executor=SingleThreadedExecutor();executor.add_node(node);thread=threading.Thread(target=executor.spin,daemon=True);thread.start()
 channel=grpc.aio.insecure_channel('broker:55600');bus=rpc.BusStub(channel)
 async def descriptor():return await bus.Describe(pb.Empty(),timeout=2)
 async def get(d):return await bus.Get(pb.Query(catalog_hash=d.catalog_hash),timeout=2)
 async def wait(check,timeout=20):
  end=time.monotonic()+timeout
  while time.monotonic()<end:
   result=await check()
   if result:return result
   await asyncio.sleep(.02)
  raise AssertionError('actual capture condition timeout: '+case)
 def samples(batch):return {v.path:v for v in batch.samples}
 try:
  async def initial():
   d=await descriptor()
   if not (d.provider_online and clocks and images and brain.get('ready')):return None
   batch=await get(d);values=samples(batch)
   if values['Robot.Perception.Marker.Count'].quality!=pb.OK:return None
   assert brain['mode'] in ('DISARMED','SAFE_STOP') and brain['authority']['owner'] is None
   return d
  before=await wait(initial);old_clock=clocks[-1][1];before_epoch=brain['scene_epoch'];largest_ok_age=0
  # Provider quality is published every50ms; qualify delivery within100ms.
  delivery_bound_ns=100_000_000
  print(json.dumps(dict(event='CAPTURE_TEST_READY',case=case)),flush=True)
  if case=='pause':
   async def frozen():
    now=time.monotonic();window=[v for at,v in list(clocks) if now-at<=.35]
    d=await descriptor()
    return bool(sim.get('paused') and len(window)>=10 and len(set(window))==1 and not d.provider_online)
   await wait(frozen)
  elif case=='perception':
   async def stale():
    nonlocal largest_ok_age
    d=await descriptor();assert d.provider_session==before.provider_session and d.provider_online
    value=samples(await get(d))['Robot.Perception.Marker.Count']
    age=clocks[-1][1]-value.source_time_ns
    if value.quality==pb.OK:
     largest_ok_age=max(largest_ok_age,age)
     assert age<1_000_000_000+delivery_bound_ns,('quality propagation exceeded bound',age)
    return value.quality in (pb.STALE,pb.NONE) and age>=1_000_000_000 and clocks[-1][1]>old_clock
   await wait(stale)
  else:
   async def changed():
    d=await descriptor()
    return d if (d.provider_online and d.provider_session!=before.provider_session
     and d.target_context.source_epoch!=before.target_context.source_epoch
     and brain.get('scene_epoch')!=before_epoch and brain.get('ready') and brain.get('nav_ready')) else None
   await wait(changed,60)
  print(json.dumps(dict(event='CAPTURE_FAULT_OBSERVED',case=case)),flush=True)
  old_backlog=0
  async def recovered():
   nonlocal old_backlog,largest_ok_age
   d=await descriptor()
   if not d.provider_online:return None
   batch=await get(d)
   if batch.provider_session!=d.provider_session:return None
   values=samples(batch);marker=values['Robot.Perception.Marker.Count']
   if marker.quality==pb.OK:
    assert marker.source_clock=='ROS_TIME' and marker.source_epoch==d.target_context.source_epoch
    age=clocks[-1][1]-marker.source_time_ns;largest_ok_age=max(largest_ok_age,age)
    assert 0<=age<1_000_000_000+delivery_bound_ns,('quality propagation exceeded bound',age)
   else:
    old_backlog+=1
    return None
   if case=='pause' and (sim.get('paused') or d.provider_session==before.provider_session or clocks[-1][1]<=old_clock):return None
   if case=='epoch':
    if d.target_context.source_epoch==before.target_context.source_epoch:return None
    for value in batch.samples:
     if value.quality==pb.OK and value.source_clock=='ROS_TIME':
      assert value.source_epoch==d.target_context.source_epoch
      assert value.source_time_ns>=old_clock,(value.path,value.source_time_ns,old_clock)
   assert brain.get('mode') in ('DISARMED','SAFE_STOP') and brain['authority']['owner'] is None
   assert values['Robot.Velocity.Linear.X'].quality==pb.OK
   assert brain.get('safe_command')==[0.,0.],brain
   assert sim.get('applied_command')==[0.,0.,0.],sim.get('applied_command')
   # Measured physics/realistic odometry may contain standing vibration/noise.
   assert abs(values['Robot.Velocity.Linear.X'].value.float64_value)<.08
   assert math.hypot(*sim['velocity'])<.08 and math.hypot(*sim['angular_velocity'])<.15
   assert not sim['fallen'] and sim['finite']
   return d
  after=await wait(recovered,60)
  print(json.dumps(dict(passed=True,case=case,scope='actual ROS/SIM capture fault; no motion start',oldProviderSession=before.provider_session,newProviderSession=after.provider_session,oldEpoch=before.target_context.source_epoch,newEpoch=after.target_context.source_epoch,oldOrMissingCaptureObservations=old_backlog,largestDeliveredOkCaptureAgeMs=largest_ok_age/1e6,qualityPropagationBoundMs=100,commandPublishers=0,leasesAcquired=0,autoArm=False)),flush=True)
 finally:
  await channel.close();executor.shutdown(timeout_sec=2);thread.join(2);node.destroy_node();rclpy.shutdown()

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--case',choices=['pause','perception','epoch'],required=True)
 asyncio.run(run(parser.parse_args().case))

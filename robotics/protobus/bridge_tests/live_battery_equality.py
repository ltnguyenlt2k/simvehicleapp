"""Explicit SIM battery stimulus via its sole ROS parameter writer, DDS/RSS equality."""
import asyncio,json,math,threading,time
from collections import OrderedDict
import grpc,rclpy
from rclpy.executors import SingleThreadedExecutor
from rclpy.parameter import Parameter
from rcl_interfaces.srv import SetParameters
from sensor_msgs.msg import BatteryState
from protobus.v1 import protobus_pb2 as pb,protobus_pb2_grpc as rpc

async def run():
 rclpy.init();node=rclpy.create_node('battery_rss_equality')
 samples=OrderedDict()
 def received(message):
  stamp=message.header.stamp.sec*10**9+message.header.stamp.nanosec
  samples[stamp]=message.percentage
  while len(samples)>200:samples.popitem(last=False)
 subscription=node.create_subscription(BatteryState,'/dog1/battery_state',received,10)
 setter=node.create_client(SetParameters,'/dog_sim/set_parameters')
 executor=SingleThreadedExecutor();executor.add_node(node)
 thread=threading.Thread(target=executor.spin,daemon=True);thread.start()
 channel=grpc.aio.insecure_channel('broker:55600');bus=rpc.BusStub(channel)
 async def set_soc(value):
  future=setter.call_async(SetParameters.Request(parameters=[Parameter('sim_battery_soc',value=value).to_parameter_msg()]))
  end=time.monotonic()+5
  while not future.done():
   assert time.monotonic()<end;await asyncio.sleep(.01)
  assert future.result().results[0].successful
 results=[]
 try:
  assert setter.wait_for_service(timeout_sec=10)
  descriptor=await bus.Describe(pb.Empty(),timeout=3)
  assert descriptor.provider_online and descriptor.target_context.kind==pb.ROS_SIM
  for value in (.12,.92):
   after=max(samples,default=0);await set_soc(value)
   end=time.monotonic()+10
   while True:
    batch=await bus.Get(pb.Query(catalog_hash=descriptor.catalog_hash,paths=['Robot.PowerSystem.Battery.StateOfCharge']),timeout=2)
    assert batch.provider_session==descriptor.provider_session
    sample=batch.samples[0];raw=samples.get(sample.source_time_ns)
    if sample.quality==pb.OK and raw is not None and sample.source_time_ns>after and abs(raw-value)<1e-6:
     actual=sample.value.float64_value
     assert math.isclose(actual,raw*100,rel_tol=1e-8,abs_tol=1e-8)
     assert sample.source_clock=='ROS_TIME' and sample.source_epoch==descriptor.target_context.source_epoch
     results.append(dict(parameter=value,rawPercentage=raw,rssPercent=actual,sourceTimeNs=sample.source_time_ns));break
    assert time.monotonic()<end,'actual battery DDS/RSS equality timeout'
    await asyncio.sleep(.03)
  assert node.count_publishers('/dog1/battery_state')==1
  print(json.dumps(dict(passed=True,scope='explicit simulated sensor stimulus, actual ROS and Protobus; no motion',results=results)),flush=True)
 finally:
  await set_soc(.92)
  await channel.close();executor.shutdown(timeout_sec=2);thread.join(2);node.destroy_node();rclpy.shutdown()

if __name__=='__main__':asyncio.run(run())

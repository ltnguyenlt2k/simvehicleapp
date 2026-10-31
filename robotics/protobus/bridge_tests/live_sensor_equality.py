"""Independent raw DDS vs broker comparison at identical source capture stamps.

Expected values are calculated here without the mapping engine/transforms.
This observer has no command publishers and never arms or moves the robot.
"""
import asyncio
import argparse
from collections import OrderedDict
import json
import math
import threading
import time

import grpc
import rclpy
from nav_msgs.msg import Odometry
from rclpy.executors import SingleThreadedExecutor
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import BatteryState,Imu
from std_msgs.msg import String
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc


def angles(q):
    norm=math.sqrt(q.x*q.x+q.y*q.y+q.z*q.z+q.w*q.w)
    x,y,z,w=(value/norm for value in (q.x,q.y,q.z,q.w))
    return dict(Roll=math.atan2(2*(w*x+y*z),1-2*(x*x+y*y)),
        Pitch=math.asin(max(-1.,min(1.,2*(w*y-z*x)))),
        Yaw=math.atan2(2*(w*z+x*y),1-2*(y*y+z*z)))


async def run(bus_address="protobus-live:55600",include_marker=False):
    rclpy.init(args=[])
    node=rclpy.create_node('protobus_raw_sensor_equality')
    loop=asyncio.get_running_loop()
    captures=OrderedDict()
    failures=[]
    expected_paths=set()
    def remember(stamp,values):
        expected_paths.update(values)
        for path,value in values.items():
            captures[(path,stamp)]=value
        while len(captures)>20000: captures.popitem(last=False)
    def receive(message,convert):
        try:
            stamp=message.header.stamp.sec*1_000_000_000+message.header.stamp.nanosec
            values=convert(message)
            loop.call_soon_threadsafe(remember,stamp,values)
        except Exception as error:
            loop.call_soon_threadsafe(failures.append,str(error))
    def imu(message):
        values={}
        for group,vector in (('AngularVelocity',message.angular_velocity),('LinearAcceleration',message.linear_acceleration)):
            for axis in ('X','Y','Z'): values['Robot.Imu.'+group+'.'+axis]=float(getattr(vector,axis.lower()))
        values.update({'Robot.Imu.Orientation.'+axis:value for axis,value in angles(message.orientation).items()})
        return values
    def odom(message):
        values={'Robot.Pose.Position.'+axis:float(getattr(message.pose.pose.position,axis.lower())) for axis in ('X','Y','Z')}
        values.update({'Robot.Pose.Orientation.'+axis:value for axis,value in angles(message.pose.pose.orientation).items()})
        values.update({'Robot.Velocity.Linear.'+axis:float(getattr(message.twist.twist.linear,axis.lower())) for axis in ('X','Y')})
        values['Robot.Velocity.Angular.Z']=float(message.twist.twist.angular.z)
        return values
    def battery(message):
        return {'Robot.PowerSystem.Battery.Current':float(message.current),
            'Robot.PowerSystem.Battery.Voltage':float(message.voltage),
            'Robot.PowerSystem.Battery.StateOfCharge':float(message.percentage)*100.}
    subscriptions=[node.create_subscription(kind,'/dog1/'+topic,
        lambda message,convert=convert:receive(message,convert),qos_profile_sensor_data)
        for kind,topic,convert in ((Imu,'imu/data',imu),(Odometry,'odom',odom),(BatteryState,'battery_state',battery))]
    if include_marker:
        def marker(message):
            try:
                payload=json.loads(message.data);capture=payload['capture_stamp']
                stamp=capture['sec']*1_000_000_000+capture['nanosec']
                objects=payload['objects']
                assert all(isinstance(item['class_id'],str) for item in objects)
                count=sum(item['class_id']=='red_sim_marker' for item in objects)
                loop.call_soon_threadsafe(remember,stamp,{'Robot.Perception.Marker.Count':count})
            except Exception as error:loop.call_soon_threadsafe(failures.append,str(error))
        subscriptions.append(node.create_subscription(String,'/dog1/perception/state',marker,qos_profile_sensor_data))
    expected_count=22 if include_marker else 21
    executor=SingleThreadedExecutor()
    executor.add_node(node)
    thread=threading.Thread(target=executor.spin,daemon=True)
    thread.start()
    matched={}
    comparisons=0
    try:
        assert all(pub.topic_name not in ('/dog1/control/request','/dog1/cmd_vel/safe','/dog1/motion/request')
            for pub in node.publishers)
        async with grpc.aio.insecure_channel(bus_address) as channel:
            bus=rpc.BusStub(channel)
            descriptor=await bus.Describe(pb.Empty(),timeout=3)
            assert descriptor.provider_online
            if include_marker:assert descriptor.protocol_version=='1.6'
            deadline=time.monotonic()+20
            while time.monotonic()<deadline:
                result=await bus.Get(pb.Query(catalog_hash=descriptor.catalog_hash),timeout=2)
                assert result.provider_session==descriptor.provider_session and result.broker_epoch==descriptor.broker_epoch
                for sample in result.samples:
                    key=(sample.path,sample.source_time_ns)
                    if sample.quality!=pb.OK or key not in captures: continue
                    assert sample.source_clock=='ROS_TIME' and sample.source_epoch.startswith('dog:')
                    expected=captures[key]
                    actual=getattr(sample.value,sample.value.WhichOneof('kind'))
                    assert math.isclose(actual,expected,rel_tol=1e-8,abs_tol=1e-8),(sample.path,actual,expected,key)
                    matched[sample.path]=dict(source_time_ns=sample.source_time_ns,expected=expected,actual=actual)
                    comparisons+=1
                if len(matched)==expected_count and comparisons>=100: break
                await asyncio.sleep(.02)
            assert not failures,failures
            assert len(expected_paths)==expected_count and len(matched)==expected_count,(sorted(expected_paths-set(matched)),len(matched))
            assert comparisons>=100,comparisons
            charging=next(sample for sample in result.samples if sample.path=='Robot.PowerSystem.Battery.IsCharging')
            assert charging.quality==pb.NONE,'unknown battery charging status must stay unavailable'
            print(json.dumps({'passed':True,'matched_paths':len(matched),'exact_capture_comparisons':comparisons,
                'relative_tolerance':1e-8,'absolute_tolerance':1e-8,'unknown_charging_quality':'NONE',
                'matches':matched,'command_publishers':0}),flush=True)
    finally:
        executor.shutdown(timeout_sec=2)
        thread.join(2)
        node.destroy_node()
        rclpy.shutdown()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--marker',action='store_true')
    parser.add_argument('--bus',default='protobus-live:55600')
    args=parser.parse_args();asyncio.run(run(args.bus,args.marker))

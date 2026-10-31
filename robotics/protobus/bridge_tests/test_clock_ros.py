"""Actual CycloneDDS clock delivery; no robot command publishers."""
import time
import threading
import unittest
import rclpy
from rclpy.executors import SingleThreadedExecutor
from rclpy.qos import qos_profile_sensor_data
from rosgraph_msgs.msg import Clock
from ros_clock import ClockProgress,stamp_ns

class ClockTransportTests(unittest.TestCase):
 def test_frozen_repeated_and_regressed_clock_messages_fail_closed(self):
  rclpy.init();reader=rclpy.create_node('progress_fixture_reader');writer=rclpy.create_node('progress_fixture_writer')
  progress=ClockProgress();captures=[]
  def received(message):
   progress.observe(stamp_ns(message.clock.sec,message.clock.nanosec),time.monotonic_ns());captures.append(progress.last_ns)
  subscription=reader.create_subscription(Clock,'/clock_progress_fixture',received,qos_profile_sensor_data)
  publisher=writer.create_publisher(Clock,'/clock_progress_fixture',qos_profile_sensor_data)
  executor=SingleThreadedExecutor();executor.add_node(reader);executor.add_node(writer)
  thread=threading.Thread(target=executor.spin,daemon=True);thread.start()
  def wait(predicate):
   end=time.monotonic()+5
   while not predicate():
    if time.monotonic()>end:raise AssertionError('actual DDS clock discovery/receipt timeout')
    time.sleep(.01)
  def publish(value):
   before=len(captures);message=Clock();message.clock.sec=value;publisher.publish(message)
   wait(lambda:len(captures)>before)
  try:
   wait(lambda:publisher.get_subscription_count()==1)
   publish(100);self.assertFalse(progress.fresh(time.monotonic_ns()))
   publish(101);self.assertTrue(progress.fresh(time.monotonic_ns()))
   until=time.monotonic()+.35
   while time.monotonic()<until:publish(101);time.sleep(.02)
   self.assertFalse(progress.fresh(time.monotonic_ns()))
   publish(102);self.assertTrue(progress.fresh(time.monotonic_ns()))
   publish(1);publish(2);self.assertTrue(progress.fault);self.assertFalse(progress.fresh(time.monotonic_ns()))
   progress.reset();publish(2);self.assertFalse(progress.fresh(time.monotonic_ns()))
   publish(3);self.assertTrue(progress.fresh(time.monotonic_ns()))
  finally:
   executor.shutdown(timeout_sec=2);thread.join(2);reader.destroy_node();writer.destroy_node();rclpy.shutdown()

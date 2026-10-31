import unittest
from broker import load_catalog
from mapping import MappingEngine,MappingError,transform

class CaptureBoundsTests(unittest.TestCase):
 def setUp(self):
  catalog=load_catalog('/contracts/fixtures/rss-go2-catalog.v1.json');self.path='Robot.Imu.AngularVelocity.X'
  profile=dict(schema='mapping.v1',profile='dog-go2-sim',adapter='dog-control/1',catalogHash=catalog['catalogHash'],backend='SIM',ros=dict(domainId=52,namespace='/fixture',useSimTime=True),setpoints={},commands={},sensors={self.path:dict(topic='imu',type='sensor_msgs/msg/Imu',field='angular_velocity.x',qos='sensor_data',maxRateHz=20)})
  self.engine=MappingEngine(catalog,profile);self.engine.reset('epoch',minimum_capture_ns=100)
 def receive(self,stamp,now=200):
  return self.engine.receive('imu',{'angular_velocity':{'x':.25},'angular_velocity_covariance':[0]*9},source_time_ns=stamp,source_epoch=self.engine.epoch,source_now_ns=now,now_ns=100_000_000)
 def test_old_capture_cannot_change_ordering(self):
  with self.assertRaises(MappingError):self.receive(99)
  self.assertFalse(self.engine.last_capture);self.assertEqual(self.receive(150),[self.path])
 def test_future_capture_does_not_poison_next_valid_stamp(self):
  with self.assertRaises(MappingError):self.receive(500)
  self.assertEqual(self.receive(150),[self.path])
 def test_clock_reset_rejects_delayed_old_high_capture(self):
  self.receive(150);self.engine.reset('next',minimum_capture_ns=10)
  with self.assertRaises(MappingError):self.receive(150,20)
  self.assertEqual(self.receive(12,20),[self.path])
 def test_repeated_capture_never_refreshes_receipt(self):
  self.receive(150);before=dict(self.engine.last_sent)
  self.assertEqual(self.receive(150,201),[]);self.assertEqual(self.engine.last_sent,before)
 def test_invalid_capture_floor_is_rejected(self):
  for value in (True,-1,1.0):
   with self.assertRaises(MappingError):self.engine.reset('x',minimum_capture_ns=value)

class MarkerCountTests(unittest.TestCase):
 def count(self,value):return transform(value,{'op':'count_where','args':{'field':'class_id','equals':'red_sim_marker'}})
 def test_only_marker_class_counts_and_empty_valid_detections_are_zero(self):
  self.assertEqual(self.count([{'class_id':'person'},{'class_id':'red_sim_marker'},{'class_id':'red_sim_marker'}]),2)
  self.assertEqual(self.count([]),0)
 def test_invalid_objects_do_not_fabricate_zero(self):
  for value in ([{}],[{'class_id':None}],[{'class_id':''}],['red_sim_marker'],None):
   with self.assertRaises(MappingError):self.count(value)

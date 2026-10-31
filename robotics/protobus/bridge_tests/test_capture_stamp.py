import json
import unittest
from std_msgs.msg import String
from ros_telemetry import capture_stamp

class OriginalCaptureTests(unittest.TestCase):
 def test_image_inference_keeps_original_capture_not_issue_time(self):
  self.assertEqual(capture_stamp(String(data=json.dumps({'issued_at_ns':9_000_000_000,'capture_stamp':{'sec':1,'nanosec':2}}))),1_000_000_002)
 def test_invalid_original_capture_never_falls_back(self):
  for stamp in ({'sec':True,'nanosec':0},{'sec':1,'nanosec':10**9},{'sec':-1,'nanosec':0},{'sec':1},None):
   with self.assertRaises((ValueError,KeyError,TypeError)):
    capture_stamp(String(data=json.dumps({'issued_at_ns':9_000_000_000,'capture_stamp':stamp})))
 def test_plain_state_json_keeps_original_issue_stamp(self):
  self.assertEqual(capture_stamp(String(data='{"issued_at_ns":123}')),123)

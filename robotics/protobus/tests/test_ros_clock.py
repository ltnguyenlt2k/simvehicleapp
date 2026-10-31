import unittest
from ros_clock import ClockProgress,stamp_ns

class ClockProgressTests(unittest.TestCase):
 def test_two_advancing_observations_required(self):
  c=ClockProgress();c.observe(100,1000);self.assertFalse(c.fresh(1000))
  c.observe(101,1001);self.assertTrue(c.fresh(1001))
 def test_repeated_messages_do_not_refresh_clock_progress(self):
  c=ClockProgress();c.observe(100,0);c.observe(101,1);c.observe(101,299_000_000)
  self.assertFalse(c.fresh(300_000_002))
 def test_missing_receipts_expire(self):
  c=ClockProgress();c.observe(100,0);c.observe(101,1)
  self.assertFalse(c.fresh(300_000_002))
 def test_regression_latches_until_explicit_epoch_reset(self):
  c=ClockProgress();c.observe(100,0);c.observe(101,1);c.observe(1,2);c.observe(2,3)
  self.assertFalse(c.fresh(3));self.assertTrue(c.fault)
  c.reset();c.observe(2,4);self.assertFalse(c.fresh(4));c.observe(3,5);self.assertTrue(c.fresh(5))
 def test_invalid_values_fail_closed(self):
  for source in (True,-1,1.0,float('nan'),2**63):
   c=ClockProgress();c.observe(source,1);self.assertTrue(c.fault);self.assertFalse(c.fresh(2))
 def test_zero_and_negative_host_age_are_not_ready(self):
  c=ClockProgress();c.observe(0,1);c.observe(0,2);self.assertFalse(c.fresh(2))
  c.observe(1,3);self.assertFalse(c.fresh(2))
 def test_source_stamp_keeps_integer_nanoseconds(self):
  self.assertEqual(stamp_ns(123,456),123_000_000_456)
 def test_invalid_stamp_fields_are_rejected(self):
  for sec,nano in [(True,0),(-1,0),(1,True),(1,-1),(1,10**9),(1.0,0)]:
   with self.assertRaises(ValueError):stamp_ns(sec,nano)

"""Humble CLI boundary: invalid Arm authorization never starts the provider."""
import os
import subprocess
import sys
import unittest


class BridgeCliTests(unittest.TestCase):
    def test_invalid_authorization_fails_before_provider_start(self):
        for value in ('TRUE','1','yes',''):
            with self.subTest(value=value):
                result=subprocess.run([sys.executable,'-m','ros_bridge','--help'],
                    env=dict(os.environ,SR_AUTHORIZE_SIM_ARM=value),capture_output=True,text=True,timeout=10)
                self.assertNotEqual(result.returncode,0)
                self.assertIn('must be exactly true or false',result.stderr)
                self.assertNotIn('ROS_SIM',result.stdout)

    def test_valid_configuration_can_show_help_without_ros_start(self):
        for value in ('true','false'):
            with self.subTest(value=value):
                result=subprocess.run([sys.executable,'-m','ros_bridge','--help'],
                    env=dict(os.environ,SR_AUTHORIZE_SIM_ARM=value),capture_output=True,text=True,timeout=10)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertIn('--authorize-sim-arm',result.stdout)
                self.assertNotIn('ROS_SIM',result.stdout)

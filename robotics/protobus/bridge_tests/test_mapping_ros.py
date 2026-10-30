"""Actual CycloneDDS fixture nodes, isolated from dog network; no motion publishers."""
import asyncio
import threading
import time
import unittest

import rclpy
from rclpy.executors import SingleThreadedExecutor
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import Imu
from std_msgs.msg import String
from broker import load_catalog
from mapping import MappingEngine
from ros_telemetry import RosTelemetry, capture_stamp
from protobus.v1 import protobus_pb2 as pb


class RosMappingTests(unittest.IsolatedAsyncioTestCase):
    async def test_actual_dds_callback_preserves_capture_and_coalesces_without_refreshing_frozen_data(self):
        catalog = load_catalog('/contracts/fixtures/rss-go2-catalog.v1.json')
        path = 'Robot.Imu.AngularVelocity.X'
        profile = dict(schema='mapping.v1', profile='dog-go2-sim', adapter='dog-control/1',
            catalogHash=catalog['catalogHash'], backend='SIM',
            ros=dict(domainId=52, namespace='/mapping_fixture', useSimTime=True),
            setpoints={}, commands={}, sensors={path: dict(topic='imu', type='sensor_msgs/msg/Imu',
                field='angular_velocity.x', qos='sensor_data', maxRateHz=20)})
        engine = MappingEngine(catalog, profile)
        engine.reset('fixture-epoch')
        rclpy.init()
        reader = rclpy.create_node('mapping_fixture_reader')
        writer = rclpy.create_node('mapping_fixture_writer')
        receiver = RosTelemetry(reader, engine, asyncio.get_running_loop(), lambda: 'fixture-epoch')
        publisher = writer.create_publisher(Imu, '/mapping_fixture/imu', qos_profile_sensor_data)
        executor = SingleThreadedExecutor()
        executor.add_node(reader)
        executor.add_node(writer)
        thread = threading.Thread(target=executor.spin, daemon=True)
        thread.start()
        async def until(predicate):
            deadline = time.monotonic()+5
            while not predicate():
                self.assertLess(time.monotonic(), deadline, 'actual DDS discovery/receipt timeout')
                await asyncio.sleep(.02)
        try:
            await until(lambda: publisher.get_subscription_count() == 1)
            message = Imu()
            message.header.stamp.sec = 123
            message.header.stamp.nanosec = 456
            message.angular_velocity.x = .25
            publisher.publish(message)
            await until(lambda: path in engine.values())
            self.assertEqual(engine.values()[path], .25)
            self.assertEqual(engine.sample_metadata(path)['source_time_ns'], 123_000_000_456)
            self.assertEqual(engine.quality(path), pb.OK)
            message.angular_velocity.x = .4
            publisher.publish(message)  # same capture is not new data
            await asyncio.sleep(.1)
            self.assertEqual(engine.values()[path], .25)
            message.header.stamp.nanosec += 1
            publisher.publish(message)
            await until(lambda: engine.values()[path] == .4)
            self.assertFalse(receiver.failures)
            await asyncio.sleep(.06)
            # Inject callback pressure deterministically; this is a mailbox test,
            # not a claim that DDS delivered all 1000 intermediate messages.
            for index in range(1000):
                burst = Imu()
                burst.header.stamp.sec = 124
                burst.header.stamp.nanosec = index
                burst.angular_velocity.x = index/1000
                receiver.receive('imu', burst)
            self.assertEqual(len(receiver.pending), 1)
            await until(lambda: engine.sample_metadata(path)['source_time_ns'] == 124_000_000_999)
            self.assertEqual(engine.values()[path], .999)
        finally:
            executor.shutdown(timeout_sec=2)
            thread.join(2)
            receiver.close()
            reader.destroy_node()
            writer.destroy_node()
            rclpy.shutdown()

    async def test_capture_metadata_rejects_missing_or_nonfinite_json_stamp(self):
        for raw in ('{}', '{"issued_at_ns":NaN}', '{"issued_at_ns":true}', '{"issued_at_ns":-1}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                capture_stamp(String(data=raw))
        self.assertEqual(capture_stamp(String(data='{"issued_at_ns":1234567890123456789}')), 1234567890123456789)

"""Explicit local SIM transport probe; never discovered by isolated CI tests.

Uses actual DDS and the installed Brain/physics. No broker/runtime acceptance is
implied. Run only on the known dog SIM network/domain with explicit authorization.
"""
import asyncio
import json
import math
from pathlib import Path
import time

import rclpy
from geometry_msgs.msg import TwistStamped
from broker import load_catalog
from dog_ros_link import DogRosLink
from mapping import MappingEngine
from protobus.v1 import protobus_pb2 as pb


async def run():
    catalog = load_catalog('/contracts/fixtures/rss-go2-catalog.v1.json')
    profile = json.loads(Path('profiles/dog-go2-sim/mapping.json').read_text())
    assert not profile['allowRemoteArm']
    profile['allowRemoteArm'] = True  # This probe explicitly authorizes SIM only.
    engine = MappingEngine(catalog, profile)
    rclpy.init(args=[])
    link = DogRosLink(engine, Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                      authorize_sim_arm=True)
    safe = [0., 0.]
    received = []
    def on_safe(message):
        safe[:] = [message.twist.linear.x, message.twist.angular.z]
        received.append(time.monotonic_ns())
        del received[:-100]
    subscription = link.node.create_subscription(TwistStamped, '/dog1/cmd_vel/safe', on_safe, 5)
    session = 'explicit-dog-link-verification'
    try:
        await link.wait_ready()
        ack = await link.request('disarm')
        assert ack['accepted'], ack
        challenge = ack['authority']['challenge']
        await link.wait(lambda: link.protocol.brain['mode'] == 'DISARMED'
            and link.protocol.brain['ready'] and link.protocol.brain['authority']['challenge'] == challenge)
        await link.wait(lambda: len(engine.observations) == 31 and len(received) > 0)
        packet = link.protocol.controller(session, time.monotonic_ns(), time.monotonic_ns()+700_000_000, 'claim')
        ack = await link.request('authority_claim', packet)
        link.protocol.accept_claim(packet, ack)
        await link.wait(link.protocol.owns)
        packet = link.protocol.controller(session, time.monotonic_ns(), time.monotonic_ns()+700_000_000)
        ack = await link.request('arm', packet)
        assert ack['accepted'], ack
        await link.wait(lambda: link.protocol.brain['mode'] == 'MANUAL')
        start_pose = [engine.values()['Robot.Pose.Position.'+axis] for axis in ('X','Y')]
        for _ in range(10):
            packet = link.protocol.controller(session,time.monotonic_ns(),time.monotonic_ns()+700_000_000,'renew')
            ack = await link.request('authority_renew', packet)
            link.protocol.accept_renew(packet, ack)
            packet = link.protocol.controller(session,time.monotonic_ns(),time.monotonic_ns()+700_000_000)
            ack = await link.request('manual',packet,linear=.3,angular=0.)
            assert ack['accepted'], ack
            await asyncio.sleep(.05)
        await link.wait(lambda: safe[0] > .1)
        await link.wait(lambda: math.hypot(engine.values()['Robot.Pose.Position.X']-start_pose[0],
                          engine.values()['Robot.Pose.Position.Y']-start_pose[1]) > .03)
        distance = math.hypot(engine.values()['Robot.Pose.Position.X']-start_pose[0],
                              engine.values()['Robot.Pose.Position.Y']-start_pose[1])
        last = time.monotonic()
        for _ in range(6):
            packet = link.protocol.controller(session,time.monotonic_ns(),time.monotonic_ns()+700_000_000,'renew')
            ack = await link.request('authority_renew',packet)
            link.protocol.accept_renew(packet,ack)
            await asyncio.sleep(.05)
        await link.wait(lambda: safe == [0.,0.])
        assert time.monotonic()-last < .5
        ack = await link.request('stop')
        assert ack['accepted'], ack
        await link.wait(lambda: link.protocol.brain['mode'] == 'SAFE_STOP'
                        and link.protocol.brain['active_motion_id'] is None and safe == [0.,0.])
        assert len(link.node.get_publishers_info_by_topic('/dog1/cmd_vel/safe')) == 1
        result = dict(passed=True, scope='actual independent DDS link only; no broker/workflow acceptance',
            source_epoch=link.protocol.source_epoch, profile_hash=engine.profile_hash,
            mapped=len(engine.observations), available=sum(item.quality == pb.OK for item in engine.observations.values()),
            odom_displacement_m=distance, safe_samples=len(received), final_mode=link.protocol.brain['mode'])
        print(json.dumps(result),flush=True)
    finally:
        try:
            await link.request('disarm')
        finally:
            link.node.destroy_subscription(subscription)
            link.close()
            rclpy.shutdown()


if __name__ == '__main__':
    asyncio.run(run())

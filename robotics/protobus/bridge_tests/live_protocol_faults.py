"""Actual Brain/DDS rejection and lost-ACK probe; never arms or sends body motion."""
import asyncio
import json
from pathlib import Path
import time
import uuid

import rclpy
from std_msgs.msg import String
from broker import load_catalog
from dog_ros_link import DogRosLink
from mapping import MappingEngine


async def run():
    catalog=load_catalog('/contracts/fixtures/rss-go2-catalog.v1.json')
    engine=MappingEngine(catalog,json.loads(Path('profiles/dog-go2-sim/mapping.json').read_text()))
    rclpy.init(args=[])
    link=DogRosLink(engine,Path('/proc/sys/kernel/random/boot_id').read_text().strip())
    acks={}
    def receive(message):
        payload=json.loads(message.data)
        acks[payload['request_id']]=payload
    observer=link.node.create_subscription(String,'/dog1/control/ack',receive,10)
    async def rejected(payload):
        link.publisher.publish(String(data=json.dumps(payload)))
        await link.wait(lambda:payload['request_id'] in acks)
        ack=acks[payload['request_id']]
        assert ack['accepted'] is False,ack
        return ack['reason']
    try:
        await link.wait_ready()
        assert (await link.request('disarm'))['accepted']
        await link.wait(lambda:link.protocol.brain['mode']=='DISARMED' and link.protocol.brain['ready'])
        await link.wait(lambda:bool(acks))  # Actual disarm ACK proves observer discovery.
        base=dict(schema=1,source='SIM',config_hash=link.protocol.brain['config_hash'],
            issued_at_ns=link.node.get_clock().now().nanoseconds,action='arm')
        wrong=dict(base,request_id=str(uuid.uuid4()),config_hash='0'*64)
        link.publisher.publish(String(data=json.dumps(wrong)))
        await asyncio.sleep(.3)
        # The producer's common envelope filter drops mismatched config before
        # the Brain callback; it intentionally emits no command admission ACK.
        assert wrong['request_id'] not in acks
        assert link.ready()
        wrong_hash='dropped by producer envelope filter; no ACK/admission'
        assert link.protocol.brain['mode']=='DISARMED'
        session='actual-protocol-faults'
        packet=link.protocol.controller(session,time.monotonic_ns(),time.monotonic_ns()+700_000_000,'claim')
        ack=await link.request('authority_claim',packet)
        link.protocol.accept_claim(packet,ack)
        await link.wait(link.protocol.owns)
        old=link.protocol.controller(session,time.monotonic_ns(),time.monotonic_ns()+700_000_000)
        # Build once, deliver only after the actual Brain grant has expired.
        delayed=link.protocol.envelope('arm',str(uuid.uuid4()),link.node.get_clock().now().nanoseconds,old)
        await link.wait(lambda:link.protocol.brain['mode']=='SAFE_STOP'
            and link.protocol.brain['authority']['owner'] is None)
        expired=await rejected(delayed)
        link.protocol.clear_grant()
        packet=link.protocol.controller(session,time.monotonic_ns(),time.monotonic_ns()+700_000_000,'reset')
        assert (await link.request('reset_stop',packet))['accepted']
        await link.wait(lambda:link.protocol.brain['mode']=='DISARMED')
        # Lose the actual ACK receiver before dispatching a real claim. A second
        # readonly observer proves Brain admission, but cannot fulfill its Future.
        link.node.destroy_subscription(link.subscriptions[3])
        packet=link.protocol.controller(session,time.monotonic_ns(),time.monotonic_ns()+700_000_000,'claim')
        request=link.send('authority_claim',packet)
        try:
            await link.response(request,.15)
        except asyncio.TimeoutError:
            pass
        else:
            raise AssertionError('lost ACK falsely completed the request')
        await link.wait(lambda:request.payload['request_id'] in acks)
        assert acks[request.payload['request_id']]['accepted'] is True
        await link.wait(lambda:link.protocol.brain['mode']=='SAFE_STOP'
            and link.protocol.brain['authority']['owner'] is None)
        assert not link.protocol.grant_id and not link.pending
        await asyncio.sleep(.5)
        assert link.protocol.brain['mode']=='SAFE_STOP'
        publisher_topics=[pub.topic_name for pub in link.node.publishers]
        assert not any(topic in publisher_topics for topic in ('/dog1/motion/request','/dog1/cmd_vel/safe','/dog1/cmd_vel'))
        assert '/dog1/control/request' in publisher_topics
        print(json.dumps({'passed':True,'wrong_hash_rejection':wrong_hash,'expired_controller_rejection':expired,
            'actual_claim_ack_lost':True,'auto_arm':False,'pending_requests':len(link.pending),
            'body_published':False,'publisher_topics':publisher_topics}),flush=True)
    finally:
        link.node.destroy_subscription(observer)
        link.close()
        rclpy.shutdown()


if __name__=='__main__': asyncio.run(run())

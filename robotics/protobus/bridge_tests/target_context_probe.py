"""Actual DDS metadata observer. No robot command publisher or lease."""
import asyncio
import json
from pathlib import Path
import time
from types import SimpleNamespace

from google.protobuf.json_format import MessageToDict
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from broker import load_catalog
from dog_backend import DogBackend
from dog_protocol import DogProtocol
from identity import validate_context
from mapping import MappingEngine


async def main():
    catalog=load_catalog('/catalog/rss-catalog.json')
    profile=json.loads(Path('profiles/dog-go2-sim/mapping.json').read_text())
    assert profile['allowRemoteArm'] is False
    engine=MappingEngine(catalog,profile)
    protocol=DogProtocol(Path('/proc/sys/kernel/random/boot_id').read_text().strip())
    link=SimpleNamespace(protocol=protocol,authorize_sim_arm=False)
    backend=DogBackend(catalog,engine,link)
    rclpy.init(args=[]);node=Node('protobus_target_context_observer',enable_rosout=False)
    frames=[]
    def received(message):
        frame=json.loads(message.data);protocol.update_brain(frame,time.monotonic_ns())
        frames.append(frame['issued_at_ns'])
    subscription=node.create_subscription(String,profile['ros']['namespace'].rstrip('/')+'/brain/state',received,1)
    try:
        end=time.monotonic()+10
        while len(frames)<2 and time.monotonic()<end:
            rclpy.spin_once(node,timeout_sec=0);await asyncio.sleep(.01)
        assert len(frames)>=2,'actual Brain DDS frames unavailable'
        first=validate_context(backend.target_context('observer-no-provider-session'))
        initial_stamp=frames[-1];started=time.monotonic()
        while time.monotonic()-started<.35:
            rclpy.spin_once(node,timeout_sec=0);await asyncio.sleep(.01)
        second=validate_context(backend.target_context('observer-no-provider-session'))
        assert first==second,'actual target context changed during observation'
        assert frames[-1]>initial_stamp,'actual source clock did not advance during observation'
        infrastructure=[publisher.topic_name for publisher in node.publishers]
        assert set(infrastructure)<= {'/parameter_events'},'observer must create no robot command publisher'
        print(json.dumps(dict(passed=True,scope='actual DDS metadata only; no motion/freshness acceptance',
            commandPublishers=0,leasesAcquired=0,requestsSent=0,brainFrames=len(frames),
            infrastructurePublishers=infrastructure,
            sourceStampFirstNs=str(initial_stamp),sourceStampLastNs=str(frames[-1]),
            context=MessageToDict(second)),sort_keys=True),flush=True)
    finally:
        node.destroy_node();rclpy.shutdown()


if __name__=='__main__':asyncio.run(main())

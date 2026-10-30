"""Read-only sustained actual live telemetry gate; criteria fixed in M24 soak plan."""
import argparse
import asyncio
from collections import Counter
import json
import time

import grpc
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc

PATHS={'Robot.Imu.AngularVelocity.X':12,'Robot.Pose.Position.X':12,
    'Robot.Safety.Mode':8,'Robot.Simulation.TimeNs':8,'Robot.PowerSystem.Battery.Voltage':.8}


async def subscriber(number,duration):
    async with grpc.aio.insecure_channel('protobus-live:55600') as channel:
        bus=rpc.BusStub(channel)
        descriptor=await bus.Describe(pb.Empty(),timeout=3)
        assert descriptor.provider_online and descriptor.audit_ok
        started=time.monotonic()
        window=started
        counts=Counter()
        totals=Counter()
        seen={}
        received={}
        baseline={}
        available=set()
        epochs=set()
        max_gap=0.
        windows=0
        stream=bus.Subscribe(pb.Query(catalog_hash=descriptor.catalog_hash,min_interval_ms=10))
        async def watch_changes():
            while True:
                result=await stream.read()
                assert result is not grpc.aio.EOF,'live subscription closed'
                for sample in result.samples:
                    if sample.quality==pb.OK and sample.source_clock=='ROS_TIME':
                        available.add(sample.path)
                    if sample.path in PATHS:
                        assert sample.quality==pb.OK,(number,sample.path,pb.Quality.Name(sample.quality))
        watcher=asyncio.create_task(watch_changes())
        try:
            while time.monotonic()-started<duration:
                if watcher.done(): watcher.result()
                # Subscribe is on-change: fresh constant values need no event.
                # Count distinct captures from current records instead.
                result=await bus.Get(pb.Query(catalog_hash=descriptor.catalog_hash,paths=list(PATHS)),timeout=2)
                now=time.monotonic()
                for sample in result.samples:
                    if sample.quality==pb.OK and sample.source_clock=='ROS_TIME':
                        available.add(sample.path)
                    if sample.path not in PATHS: continue
                    assert sample.quality==pb.OK,(number,sample.path,pb.Quality.Name(sample.quality))
                    assert sample.source_clock=='ROS_TIME' and sample.source_epoch.startswith('dog:')
                    epochs.add(sample.source_epoch)
                    assert len(epochs)==1,'source epoch changed during nominal soak'
                    capture=(sample.source_epoch,sample.source_time_ns)
                    if seen.get(sample.path)==capture: continue
                    if sample.path in received:
                        gap=now-received[sample.path]
                        max_gap=max(max_gap,gap)
                        limit=1.5 if sample.path=='Robot.PowerSystem.Battery.Voltage' else .5
                        assert gap<=limit,(number,sample.path,gap)
                    seen[sample.path]=capture
                    received[sample.path]=now
                    counts[sample.path]+=1
                    totals[sample.path]+=1
                if now-window>=60:
                    elapsed=now-window
                    rates={path:counts[path]/elapsed for path in PATHS}
                    for path,minimum in PATHS.items():
                        maximum=1.2 if path=='Robot.PowerSystem.Battery.Voltage' else 21
                        assert minimum<=rates[path]<=maximum,(number,path,rates[path])
                        assert rates[path]>=baseline.get(path,rates[path])*.75,(number,path,'rate declined',rates)
                    if not baseline: baseline=dict(rates)
                    windows+=1
                    print(json.dumps({'event':'minute','subscriber':number,'elapsed_s':now-started,
                        'rates_hz':rates,'available_paths':len(available),'max_unique_capture_gap_s':max_gap}),flush=True)
                    counts.clear()
                    window=now
                assert time.monotonic()-max(received.values(),default=started)<2
                await asyncio.sleep(.02)
            assert len(available)>=20 and windows>=int(duration//60)-1
            descriptor2=await bus.Describe(pb.Empty(),timeout=3)
            assert descriptor2.provider_online and descriptor2.audit_ok and descriptor2.broker_epoch==descriptor.broker_epoch
            return dict(subscriber=number,duration_s=time.monotonic()-started,complete_windows=windows,
                available_paths=len(available),unique_samples=dict(totals),max_gap_s=max_gap)
        finally:
            stream.cancel()
            watcher.cancel()
            await asyncio.gather(watcher,return_exceptions=True)


async def run(duration):
    results=await asyncio.gather(*(subscriber(number,duration) for number in range(4)))
    print(json.dumps({'passed':True,'duration_s':duration,'subscribers':results,
        'scope':'actual stopped live ROS telemetry; no workflow/hardware acceptance'}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--duration',type=int,default=1800)
    duration=parser.parse_args().duration
    if duration<1800: raise ValueError('M24 soak requires at least 1800 seconds')
    asyncio.run(run(duration))

"""S-R4: real gRPC producer + four subscribers, separate minimal broker process.

This is transport feasibility evidence, not a production broker or safety gate.
"""
import argparse
import asyncio
from collections import Counter, deque
import json
import multiprocessing as mp
from pathlib import Path
import statistics
import tempfile
import time

import grpc
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc


class MinimalBus(rpc.BusServicer, rpc.ProviderServicer):
    def __init__(self):
        self.subscribers = set()

    async def Subscribe(self, request, context):
        queue = asyncio.Queue(maxsize=128)
        self.subscribers.add(queue)
        try:
            while True:
                yield await queue.get()
        finally:
            self.subscribers.discard(queue)

    async def Attach(self, requests, context):
        async for packet in requests:
            if packet.WhichOneof('packet') == 'samples':
                stamp = time.monotonic_ns()
                batch = packet.samples
                for sample in batch.samples:
                    sample.broker_time_ns = stamp
                for queue in tuple(self.subscribers):
                    if queue.full():
                        await context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, 'slow subscriber')
                    queue.put_nowait(batch)
            yield pb.Reply(ok=True)


def server_process(port_queue):
    async def serve():
        server = grpc.aio.server()
        service = MinimalBus()
        rpc.add_BusServicer_to_server(service, server)
        rpc.add_ProviderServicer_to_server(service, server)
        port = server.add_insecure_port('127.0.0.1:0')
        await server.start()
        port_queue.put(port)
        await server.wait_for_termination()
    asyncio.run(serve())


def rss_kib(pid):
    for line in Path(f'/proc/{pid}/status').read_text().splitlines():
        if line.startswith('VmRSS:'):
            return int(line.split()[1])
    raise RuntimeError('RSS unavailable')


async def run(args, process, port):
    channel = grpc.aio.insecure_channel(f'127.0.0.1:{port}')
    await asyncio.wait_for(channel.channel_ready(), 10)
    bus, provider = rpc.BusStub(channel), rpc.ProviderStub(channel)
    counts = [0] * 4
    latency_ms = deque(maxlen=100000)
    end_to_end_ms = deque(maxlen=100000)
    latency_histogram = Counter()
    end_to_end_histogram = Counter()
    memory = []
    subscribers = []
    sent = 0
    acknowledgements = 0
    start = None
    async def consume(index):
        call = bus.Subscribe(pb.Query())
        subscribers.append(call)
        async for batch in call:
            now = time.monotonic_ns()
            counts[index] += len(batch.samples)
            if batch.samples:
                latency_ms.append((now - batch.samples[0].broker_time_ns) / 1e6)
                end_to_end_ms.append((now - batch.samples[0].source_time_ns) / 1e6)
                latency_histogram[min(10000, int(latency_ms[-1] * 100))] += 1
                end_to_end_histogram[min(10000, int(end_to_end_ms[-1] * 100))] += 1
    tasks = [asyncio.create_task(consume(index)) for index in range(4)]
    await asyncio.sleep(.5)
    async def produce():
        nonlocal sent, start
        yield pb.ProviderPacket(hello=pb.ProviderHello(provider_id='benchmark', session='s-r4', backend='SIM'))
        start = time.monotonic()
        batches = 0
        # 50 paths every 9.9 ms: offer slightly above 5,000/s so measured
        # throughput must meet the exact >=5,000/s gate without rounding.
        while time.monotonic() - start < args.seconds:
            source = time.monotonic_ns()
            yield pb.ProviderPacket(samples=pb.Samples(provider_session='s-r4', samples=[
                pb.Sample(path=f'Robot.Benchmark.Signal{i}', value=pb.Value(float64_value=float(batches)),
                          source_time_ns=source, quality=pb.OK, sequence=batches+1)
                for i in range(50)]))
            sent += 50
            batches += 1
            if batches % 100 == 0:
                memory.append({'t': round(time.monotonic()-start, 3), 'rssKiB': rss_kib(process.pid)})
                if batches % 6000 == 0:
                    print(json.dumps({'progressSeconds': round(time.monotonic()-start), 'samples': sent,
                                      'subscriberCounts': counts, 'brokerRssKiB': memory[-1]['rssKiB']}), flush=True)
            await asyncio.sleep(max(0, start + batches*.0099 - time.monotonic()))
    call = provider.Attach(produce())
    async for ack in call:
        if not ack.ok:
            raise AssertionError(ack)
        acknowledgements += 1
    elapsed = time.monotonic() - start
    deadline = time.monotonic() + 5
    while any(n < sent for n in counts) and time.monotonic() < deadline:
        if any(t.done() for t in tasks):
            for task in tasks:
                if task.done():
                    task.result()
        await asyncio.sleep(.01)
    for sub in subscribers:
        sub.cancel()
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await channel.close()
    if not latency_ms or len(memory) < 2:
        raise AssertionError('Missing measurement evidence')
    def percentile(values, fraction):
        values = sorted(values)
        return values[min(len(values)-1, int(len(values)*fraction))]
    def total_percentile(histogram, fraction):
        threshold = sum(histogram.values()) * fraction
        seen = 0
        for bucket, count in sorted(histogram.items()):
            seen += count
            if seen >= threshold:
                return (bucket + 1) / 100
        raise AssertionError('Empty latency histogram')
    # Compare the stabilized second minute with final minute, allowing allocator noise.
    initial = [x['rssKiB'] for x in memory if 60 <= x['t'] <= 120] or [x['rssKiB'] for x in memory[:5]]
    final = [x['rssKiB'] for x in memory[-60:]]
    growth = statistics.median(final) - statistics.median(initial)
    result = {'schema': 's-r4-result.v1', 'durationSeconds': elapsed, 'inputSamples': sent,
              'sampleRate': sent/elapsed, 'subscribers': 4, 'subscriberCounts': counts,
              'acknowledgedBatches': acknowledgements, 'latencyP50Ms': percentile(latency_ms,.5),
              'latencyP95Ms': total_percentile(latency_histogram,.95),
              'endToEndP95Ms': total_percentile(end_to_end_histogram,.95),
              'latencyWindow': 'entire run; upper bound of 0.01 ms histogram bucket',
              'rollingLatencyP95Ms': percentile(latency_ms,.95),
              'latencyObservations': sum(latency_histogram.values()),
              'brokerMemoryGrowthKiB': growth, 'memory': memory,
              'limits': {'p95Ms': 5, 'rateSamplesPerSecond': 5000, 'memoryGrowthKiB': 8192}}
    result['pass'] = (result['sampleRate'] >= 5000 and elapsed <= args.seconds + 1
                      and counts == [sent]*4 and result['latencyP95Ms'] < 5 and growth <= 8192)
    if args.seconds < 1800:
        result['qualification'] = 'SMOKE_ONLY'
    else:
        result['qualification'] = 'FULL_30_MINUTE_SPIKE'
    Path(args.output).write_text(json.dumps(result, indent=2))
    print(json.dumps({k:v for k,v in result.items() if k!='memory'}), flush=True)
    if not result['pass']:
        raise SystemExit(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--seconds', type=int, default=1800)
    parser.add_argument('--output', default='/evidence/s-r4.json')
    args = parser.parse_args()
    # Fail before running a long measurement if the evidence directory is not writable.
    with tempfile.TemporaryFile(dir=Path(args.output).parent):
        pass
    mp.set_start_method('spawn')
    queue = mp.Queue()
    process = mp.Process(target=server_process, args=(queue,))
    process.start()
    try:
        port = queue.get(timeout=10)
        asyncio.run(run(args, process, port))
    finally:
        process.terminate()
        process.join(timeout=10)
        if process.is_alive():
            process.kill()
            process.join(timeout=5)


if __name__ == '__main__':
    main()

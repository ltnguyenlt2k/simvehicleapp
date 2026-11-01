"""Spike S-R2: is a Python asyncio gRPC broker fast enough on a modest machine? (ADR-0070)

Load: 300 signals, 2,000 updates/s from one provider stream, 20 subscribers (all paths, 20 Hz/path cap).
Measures source→subscriber latency (same host clock), broker CPU (process time / wall) and RSS.

    python sr2_broker_bench.py broker  --port 55590 --seconds 40
    python sr2_broker_bench.py provider --port 55590 --seconds 30
    python sr2_broker_bench.py subscribers --port 55590 --seconds 30 --count 20
"""
import argparse
import asyncio
import json
import resource
import statistics
import time

import grpc
from google.protobuf import struct_pb2

from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc

PATHS = [f"Robot.Bench.Signal{i:03d}" for i in range(300)]


class Subscriber:
    def __init__(self, rate_hz: float):
        self.period = 1.0 / rate_hz
        self.pending: dict[str, pb.Sample] = {}
        self.last_sent: dict[str, float] = {}
        self.wake = asyncio.Event()

    def offer(self, sample: pb.Sample, now: float) -> None:
        self.pending[sample.path] = sample  # latest-wins
        due = self.last_sent.get(sample.path, 0.0) + self.period
        if now >= due:
            self.wake.set()
        else:
            asyncio.get_running_loop().call_at(asyncio.get_running_loop().time() + (due - now), self.wake.set)


class Broker(rpc.BrokerServicer, rpc.ProviderServicer):
    def __init__(self):
        self.values: dict[str, pb.Sample] = {}
        self.subscribers: list[Subscriber] = []

    async def Attach(self, request_iterator, context):
        async for message in request_iterator:
            if message.HasField("samples"):
                now = time.monotonic()
                receive = time.time_ns()
                for sample in message.samples.samples:
                    sample.receive_time_ns = receive
                    self.values[sample.path] = sample
                    for sub in self.subscribers:
                        sub.offer(sample, now)
        if False:
            yield pb.BrokerMessage()

    async def Subscribe(self, request, context):
        sub = Subscriber(request.max_rate_hz or 20.0)
        self.subscribers.append(sub)
        try:
            while True:
                await sub.wake.wait()
                sub.wake.clear()
                now = time.monotonic()
                batch = [s for p, s in sub.pending.items() if now >= sub.last_sent.get(p, 0.0) + sub.period - 1e-4]
                for s in batch:
                    del sub.pending[s.path]
                    sub.last_sent[s.path] = now
                if batch:
                    yield pb.SubscribeResponse(samples=batch)
        finally:
            self.subscribers.remove(sub)


async def run_broker(port: int, seconds: float) -> None:
    server = grpc.aio.server()
    broker = Broker()
    rpc.add_BrokerServicer_to_server(broker, server)
    rpc.add_ProviderServicer_to_server(broker, server)
    server.add_insecure_port(f"0.0.0.0:{port}")
    await server.start()
    await asyncio.sleep(5)  # warm-up while clients connect
    cpu0, wall0 = time.process_time(), time.monotonic()
    await asyncio.sleep(seconds - 5)
    cores = (time.process_time() - cpu0) / (time.monotonic() - wall0)
    print(json.dumps({"role": "broker", "cpuCores": round(cores, 3),
                      "maxRssMiB": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)}), flush=True)
    await server.stop(1)


async def run_provider(port: int, seconds: float, rate: int) -> None:
    async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
        stub = rpc.ProviderStub(channel)
        tick, per_tick = 0.01, rate // 100

        async def messages():
            index, end = 0, time.monotonic() + seconds
            next_at = time.monotonic()
            while time.monotonic() < end:
                batch = []
                for _ in range(per_tick):
                    value = struct_pb2.Value(number_value=index * 0.001)
                    batch.append(pb.Sample(path=PATHS[index % len(PATHS)], value=value,
                                           capture_time_ns=time.time_ns(), quality=pb.OK))
                    index += 1
                yield pb.ProviderMessage(samples=pb.ProviderSamples(samples=batch))
                next_at += tick
                await asyncio.sleep(max(0.0, next_at - time.monotonic()))
            print(json.dumps({"role": "provider", "sent": index}), flush=True)

        call = stub.Attach(messages())
        async for _ in call:
            pass


async def run_subscribers(port: int, seconds: float, count: int) -> None:
    latencies: list[float] = []
    received = 0
    lagged = 0

    async def one():
        nonlocal received, lagged
        async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            stub = rpc.BrokerStub(channel)
            stream = stub.Subscribe(pb.SubscribeRequest(paths=PATHS, max_rate_hz=20))
            end = time.monotonic() + seconds
            try:
                async for response in stream:
                    now = time.time_ns()
                    for sample in response.samples:
                        received += 1
                        latencies.append((now - sample.capture_time_ns) / 1e6)
                    if time.monotonic() > end:
                        break
            finally:
                stream.cancel()

    await asyncio.gather(*(one() for _ in range(count)))
    latencies.sort()
    q = lambda p: round(latencies[min(len(latencies) - 1, int(len(latencies) * p))], 2)
    print(json.dumps({"role": "subscribers", "count": count, "received": received, "lagged": lagged,
                      "latencyMs": {"p50": q(0.5), "p95": q(0.95), "p99": q(0.99), "max": q(1.0),
                                    "mean": round(statistics.fmean(latencies), 2)}}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("role", choices=["broker", "provider", "subscribers"])
    parser.add_argument("--port", type=int, default=55590)
    parser.add_argument("--seconds", type=float, default=30)
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--rate", type=int, default=2000)
    args = parser.parse_args()
    if args.role == "broker":
        asyncio.run(run_broker(args.port, args.seconds))
    elif args.role == "provider":
        asyncio.run(run_provider(args.port, args.seconds, args.rate))
    else:
        asyncio.run(run_subscribers(args.port, args.seconds, args.count))


if __name__ == "__main__":
    main()

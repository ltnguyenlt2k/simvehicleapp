"""Load benchmark against the real broker (M23 gate, reused by M27).

A bench provider owns every sensor of the catalog and pushes N updates/s; S subscribers watch Robot.* at 20 Hz.
Reports source→subscriber latency percentiles and delivery counts. Broker CPU/RSS are read from its cgroup
by the caller (docker stats), not from inside the broker.

    python -m protobus.bench --broker HOST:55500 --safety HOST:55501 --rate 2000 --subscribers 20 --seconds 30
"""
from __future__ import annotations

import argparse
import asyncio
import json
import time

import grpc

from protobus.catalog import Catalog
from protobus.provider_client import ProviderClient
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc


class Quiet:
    async def on_command(self, *a): pass
    async def on_cancel(self, *a): pass
    async def on_setpoint(self, *a): pass
    async def on_control(self, *a): pass
    async def on_stop(self, request): return True


async def run(args) -> dict:
    async with grpc.aio.insecure_channel(args.broker) as channel:
        catalog = Catalog({**json.loads((await rpc.BrokerStub(channel).GetCatalog(pb.GetCatalogRequest())).catalog_json)})
    paths = catalog.leaves(("sensor",))
    client = ProviderClient(args.broker, args.safety, "bench", catalog.hash, paths, Quiet())
    provider = asyncio.ensure_future(client.run())
    await asyncio.wait_for(client.connected.wait(), 10)
    latencies: list[float] = []
    received = 0
    lagged = 0
    end = time.monotonic() + args.seconds

    async def subscriber():
        nonlocal received, lagged
        async with grpc.aio.insecure_channel(args.broker) as channel:
            stream = rpc.BrokerStub(channel).Subscribe(pb.SubscribeRequest(paths=["Robot.*"], max_rate_hz=20))
            async for response in stream:
                now = time.time_ns()
                lagged += response.lagged
                for sample in response.samples:
                    if sample.capture_time_ns:
                        received += 1
                        latencies.append((now - sample.capture_time_ns) / 1e6)
                if time.monotonic() > end:
                    stream.cancel()
                    return

    async def produce():
        per_tick, index, next_at, sent = max(1, args.rate // 100), 0, time.monotonic(), 0
        while time.monotonic() < end:
            batch = {}
            for _ in range(per_tick):
                batch[paths[index % len(paths)]] = float(index)
                index += 1
            client.publish(batch)
            sent += len(batch)
            next_at += 0.01
            await asyncio.sleep(max(0.0, next_at - time.monotonic()))
        return sent

    subs = [asyncio.ensure_future(subscriber()) for _ in range(args.subscribers)]
    await asyncio.sleep(1.0)
    sent = await produce()
    await asyncio.gather(*subs, return_exceptions=True)
    provider.cancel()
    latencies.sort()
    pick = lambda q: round(latencies[min(len(latencies) - 1, int(len(latencies) * q))], 2) if latencies else None
    return {"rate": args.rate, "subscribers": args.subscribers, "seconds": args.seconds, "paths": len(paths),
            "sent": sent, "delivered": received, "laggedBatches": lagged, "droppedAtProvider": client.dropped_samples,
            "latencyMs": {"p50": pick(0.5), "p95": pick(0.95), "p99": pick(0.99), "max": pick(1.0)}}


def main() -> None:
    parser = argparse.ArgumentParser(prog="protobus.bench")
    parser.add_argument("--broker", required=True)
    parser.add_argument("--safety", required=True)
    parser.add_argument("--rate", type=int, default=2000)
    parser.add_argument("--subscribers", type=int, default=20)
    parser.add_argument("--seconds", type=float, default=30)
    print(json.dumps(asyncio.run(run(parser.parse_args()))))


if __name__ == "__main__":
    main()

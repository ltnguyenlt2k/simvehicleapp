"""pbctl — Protobus diagnostics CLI (read, watch, command, stop). Never used by workflows.

    python -m protobus.pbctl --broker HOST:55500 health
    python -m protobus.pbctl get Robot.Safety.Mode Robot.Pose.*
    python -m protobus.pbctl watch Robot.Safety.* --rate 5 --seconds 10
    python -m protobus.pbctl exec Robot.Safety.Arm            # acquires and releases a lease
    python -m protobus.pbctl exec Robot.Motion.Perform '{"Name":"BOW"}'
    python -m protobus.pbctl --safety HOST:55501 stop --reason "operator check"
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
import uuid

import grpc

from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc
from protobus.wire import from_value, to_struct

QUALITY = {pb.OK: "OK", pb.STALE: "STALE", pb.UNAVAILABLE: "UNAVAILABLE"}


def row(sample: pb.Sample) -> dict:
    return {"path": sample.path, "value": from_value(sample.value), "quality": QUALITY.get(sample.quality, "?")}


async def main_async(args) -> int:
    async with grpc.aio.insecure_channel(args.broker) as channel:
        broker = rpc.BrokerStub(channel)
        if args.command == "health":
            health = await broker.Health(pb.HealthRequest())
            print(json.dumps({"ready": health.ready, "catalogHash": health.catalog_hash,
                              "providers": list(health.providers), "leaseHolder": health.lease_holder}))
        elif args.command == "get":
            response = await broker.Get(pb.GetRequest(paths=args.paths))
            for sample in response.samples:
                print(json.dumps(row(sample)))
        elif args.command == "watch":
            end = time.monotonic() + args.seconds
            stream = broker.Subscribe(pb.SubscribeRequest(paths=args.paths, max_rate_hz=args.rate, include_initial=True))
            async for response in stream:
                for sample in response.samples:
                    print(json.dumps(row(sample)), flush=True)
                if time.monotonic() > end:
                    stream.cancel()
                    break
        elif args.command == "exec":
            lease = await broker.AcquireControl(pb.AcquireRequest(client_id="pbctl"))

            async def keep_lease():  # every controlling client renews; an expired lease cancels its commands
                while True:
                    await asyncio.sleep(lease.ttl_ms / 3000)
                    await broker.RenewControl(lease)

            renew = asyncio.ensure_future(keep_lease())
            try:
                request = pb.CommandRequest(lease_id=lease.lease_id, path=args.path, args=to_struct(json.loads(args.args)),
                                            request_id=str(uuid.uuid4()))
                async for update in broker.Execute(request):
                    print(json.dumps({"requestId": update.request_id, "phase": pb.CommandPhase.Name(update.phase),
                                      "code": update.code, "message": update.message}), flush=True)
            finally:
                renew.cancel()
                await broker.ReleaseControl(lease)
        elif args.command == "stop":
            async with grpc.aio.insecure_channel(args.safety) as safety_channel:
                result = await rpc.SafetyLaneStub(safety_channel).Stop(
                    pb.StopRequest(request_id=str(uuid.uuid4()), source="OPERATOR", reason=args.reason))
                print(json.dumps({"confirmed": result.confirmed, "code": result.code, "message": result.message}))
                return 0 if result.confirmed else 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="pbctl")
    parser.add_argument("--broker", default=os.environ.get("PB_BROKER", "127.0.0.1:55500"))
    parser.add_argument("--safety", default=os.environ.get("PB_SAFETY", "127.0.0.1:55501"))
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("health")
    get = sub.add_parser("get")
    get.add_argument("paths", nargs="+")
    watch = sub.add_parser("watch")
    watch.add_argument("paths", nargs="+")
    watch.add_argument("--rate", type=float, default=5)
    watch.add_argument("--seconds", type=float, default=10)
    run = sub.add_parser("exec")
    run.add_argument("path")
    run.add_argument("args", nargs="?", default="{}")
    stop = sub.add_parser("stop")
    stop.add_argument("--reason", default="pbctl")
    return asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())

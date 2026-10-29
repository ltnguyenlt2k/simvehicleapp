"""Bounded socket health probes; no authority acquisition or motion."""
import argparse
import asyncio
import grpc
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc


async def check(address, provider):
    async with grpc.aio.insecure_channel(address) as channel:
        bus = rpc.BusStub(channel)
        descriptor = await bus.Describe(pb.Empty(), timeout=2)
        if descriptor.backend != 'SIM' or not descriptor.audit_ok:
            raise RuntimeError('SIM broker/audit unavailable')
        if provider:
            result = await bus.Get(pb.Query(catalog_hash=descriptor.catalog_hash,
                paths=['Robot.Connection.IsHandshakeComplete']), timeout=2)
            if not descriptor.provider_online or not result.samples or result.samples[0].quality != pb.OK or not result.samples[0].value.bool_value:
                raise RuntimeError('provider handshake incomplete')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bus', default='127.0.0.1:55600')
    parser.add_argument('--provider', action='store_true')
    args = parser.parse_args()
    asyncio.run(check(args.bus, args.provider))

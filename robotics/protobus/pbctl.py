"""Local Protobus diagnostic CLI. Lease tokens stay in private files, not stdout."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import uuid

import grpc
from google.protobuf.json_format import MessageToDict, ParseDict
from provider import scalar_value
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc


def output(message):
    print(json.dumps(MessageToDict(message), sort_keys=True), flush=True)


def write_private(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError('lease file must not be a symlink')
    with tempfile.NamedTemporaryFile('w', dir=path.parent, prefix=path.name+'.', delete=False) as handle:
        json.dump(value, handle, sort_keys=True)
        temporary = Path(handle.name)
    temporary.chmod(0o600)
    temporary.replace(path)


def read_private(path):
    if path.is_symlink():
        raise ValueError('lease file must not be a symlink')
    data = json.loads(path.read_text())
    if data.get('schema') != 'pbctl-lease.v1':
        raise ValueError('unknown lease file schema')
    return data


def typed_object(values, fields):
    if not isinstance(values, dict) or set(values) != set(fields):
        raise ValueError('complete exact fields required: '+', '.join(fields))
    result = pb.Object()
    for name, spec in fields.items():
        value = values[name]
        if spec['type'] == 'int64' and isinstance(value, str):
            value = int(value)
        result.fields[name].CopyFrom(scalar_value(value, spec))
    return result


async def run(args):
    channel = grpc.aio.insecure_channel(args.bus)
    renewal = None
    try:
        await asyncio.wait_for(channel.channel_ready(), 3)
        bus = rpc.BusStub(channel)
        descriptor = await bus.Describe(pb.Empty(), timeout=2)
        if args.command == 'describe':
            output(descriptor)
            return 0
        if args.command in ('get', 'subscribe'):
            query = pb.Query(paths=args.paths, catalog_hash=descriptor.catalog_hash,
                             min_interval_ms=getattr(args, 'interval', 0))
            if args.command == 'get':
                output(await bus.Get(query, timeout=2))
            else:
                count = 0
                async for batch in bus.Subscribe(query):
                    output(batch)
                    count += 1
                    if args.count and count >= args.count:
                        break
            return 0
        if args.command == 'stop':
            output(await bus.Stop(pb.StopRequest(reason=args.reason), timeout=3))
            return 0
        if args.command == 'inspect':
            output(await bus.InspectExecution(pb.ExecutionQuery(catalog_hash=descriptor.catalog_hash,
                broker_epoch=args.epoch, execution_id=args.execution), timeout=2))
            return 0
        if descriptor.backend != 'SIM' or descriptor.protocol_version != '1.6':
            raise ValueError('writes require the supported local SIM protocol 1.6')
        if not args.lease_file:
            raise ValueError('--lease-file is required for control operations')
        path = Path(args.lease_file)
        if args.command == 'lease' and args.operation == 'acquire':
            if path.exists() or path.is_symlink():
                raise ValueError('lease file already exists; release the existing lease first')
            lease = await bus.AcquireLease(pb.LeaseRequest(client_id=args.client,
                catalog_hash=descriptor.catalog_hash, ttl_ms=args.ttl), timeout=2)
            data = {'schema': 'pbctl-lease.v1', 'lease': MessageToDict(lease),
                    'sequence': '0', 'ttl_ms': args.ttl, 'catalogHash': descriptor.catalog_hash}
            try:
                write_private(path, data)
            except Exception:
                await bus.ReleaseLease(lease, timeout=2)
                raise
            print(json.dumps({'clientId': lease.client_id, 'fence': str(lease.fence),
                              'leaseFile': str(path), 'remainingMs': lease.remaining_ms}))
            return 0
        data = read_private(path)
        if data['catalogHash'] != descriptor.catalog_hash:
            raise ValueError('lease file catalog does not match bus')
        lease = ParseDict(data['lease'], pb.Lease())
        if args.command == 'lease':
            if args.operation == 'renew':
                lease = await bus.RenewLease(lease, timeout=2)
                data['lease'] = MessageToDict(lease)
                write_private(path, data)
                print(json.dumps({'renewed': True, 'remainingMs': lease.remaining_ms}))
            else:
                output(await bus.ReleaseLease(lease, timeout=2))
                path.unlink()
            return 0
        if args.command == 'cancel':
            output(await bus.Cancel(pb.CancelRequest(lease=lease, execution_id=args.execution), timeout=2))
            return 0
        catalog = json.loads(Path(args.catalog).read_text())
        if catalog['catalogHash'] != descriptor.catalog_hash:
            raise ValueError('catalog artifact does not match bus')
        node = catalog['nodes'][args.path]
        async def renew():
            while True:
                await asyncio.sleep(max(.03, min(.5, data['ttl_ms']/3000)))
                updated = await bus.RenewLease(lease, timeout=2)
                lease.CopyFrom(updated)
                data['lease'] = MessageToDict(lease)
                write_private(path, data)
        renewal = asyncio.create_task(renew())
        if args.command == 'set':
            if node['kind'] != 'setpoint':
                raise ValueError('set requires a setpoint node')
            values = node['safeValue'] if args.release else json.loads(args.value)
            value = typed_object(values, node['fields'])
            end = time.monotonic()+args.hold_ms/1000
            async def set_once(value, release=False):
                data['sequence'] = str(int(data['sequence'])+1)
                write_private(path, data)  # consume sequence before a possibly ambiguous RPC response
                return await bus.SetTarget(pb.Target(lease=lease, path=args.path, value=value,
                    owner_id=args.owner, sequence=int(data['sequence']), release=release), timeout=2)
            output(await set_once(value, args.release))
            while not args.release and time.monotonic() < end:
                await asyncio.sleep(1/node['refreshHz'])
                if renewal.done():
                    renewal.result()
                await set_once(value)
            if args.hold_ms and not args.release:
                output(await set_once(typed_object(node['safeValue'], node['fields']), True))
            return 0
        if node['kind'] != 'command':
            raise ValueError('invoke requires a command node')
        request = pb.Invocation(lease=lease, path=args.path,
            args=typed_object(json.loads(args.args), node['args']), timeout_ms=args.timeout,
            idempotency_key=args.key or str(uuid.uuid4()))
        terminal = None
        async for update in bus.Invoke(request):
            output(update)
            terminal = update.phase
            if renewal.done():
                renewal.result()
        return 0 if terminal == pb.SUCCEEDED else 3
    finally:
        if renewal:
            renewal.cancel()
            await asyncio.gather(renewal, return_exceptions=True)
        await channel.close()


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument('--bus', default='127.0.0.1:55600')
    result.add_argument('--catalog', default='/catalog/rss-catalog.json')
    result.add_argument('--lease-file')
    commands = result.add_subparsers(dest='command', required=True)
    commands.add_parser('describe')
    inspect = commands.add_parser('inspect')
    inspect.add_argument('execution')
    inspect.add_argument('--epoch', required=True)
    for name in ('get', 'subscribe'):
        command = commands.add_parser(name)
        command.add_argument('paths', nargs='*')
        if name == 'subscribe':
            command.add_argument('--count', type=int, default=0)
            command.add_argument('--interval', type=int, default=0)
    lease = commands.add_parser('lease')
    lease.add_argument('operation', choices=['acquire', 'renew', 'release'])
    lease.add_argument('--client', default='pbctl')
    lease.add_argument('--ttl', type=int, default=5000)
    target = commands.add_parser('set')
    target.add_argument('path')
    target.add_argument('--value', default='{}')
    target.add_argument('--owner', default='pbctl-hold')
    target.add_argument('--release', action='store_true')
    target.add_argument('--hold-ms', type=int, default=0)
    invoke = commands.add_parser('invoke')
    invoke.add_argument('path')
    invoke.add_argument('--args', default='{}')
    invoke.add_argument('--timeout', type=int, default=0)
    invoke.add_argument('--key')
    cancel = commands.add_parser('cancel')
    cancel.add_argument('execution')
    stop = commands.add_parser('stop')
    stop.add_argument('--reason', default='pbctl operator STOP')
    return result


def main():
    args = parser().parse_args()
    try:
        if getattr(args, 'hold_ms', 0) not in range(0, 60001):
            raise ValueError('hold-ms must be between 0 and 60000')
        return asyncio.run(run(args))
    except (ValueError, KeyError, OSError, grpc.aio.AioRpcError, asyncio.TimeoutError) as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())

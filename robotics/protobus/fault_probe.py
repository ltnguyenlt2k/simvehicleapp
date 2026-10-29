"""Separate-process synthetic-provider observer. Run by scripts/fault-test.py."""
import asyncio
import json
from pathlib import Path
import time
import uuid
import grpc
from google.protobuf.json_format import MessageToDict
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc
from protobus.mock.v1 import mock_pb2_grpc as mrpc


def record(name, value):
    path = Path('/tmp/'+name+'.json')
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value))
    temporary.replace(path)


async def marker(name, seconds=30):
    path = Path('/tmp/'+name+'.json')
    deadline = time.monotonic()+seconds
    while not path.exists():
        if time.monotonic() > deadline:
            raise TimeoutError(name)
        await asyncio.sleep(.02)
    return json.loads(path.read_text())


async def run():
    async with grpc.aio.insecure_channel('protobus-sim:55600') as channel, grpc.aio.insecure_channel('mock-observer:55601') as observer:
        bus, mock = rpc.BusStub(channel), mrpc.MockControlStub(observer)
        descriptor = await bus.Describe(pb.Empty(), timeout=2)
        lease = await bus.AcquireLease(pb.LeaseRequest(client_id='process-fault-test',
            catalog_hash=descriptor.catalog_hash, ttl_ms=500), timeout=2)
        phase = None
        async for item in bus.Invoke(pb.Invocation(lease=lease, path='Robot.Safety.Arm',
                idempotency_key=str(uuid.uuid4()))):
            phase = item.phase
        assert phase == pb.SUCCEEDED, phase
        sequence = 0
        async def drive():
            nonlocal sequence
            while True:
                sequence += 1
                await bus.RenewLease(lease, timeout=.3)
                await bus.SetTarget(pb.Target(lease=lease, path='Robot.Motion.Velocity',
                    owner_id='fault-hold', sequence=sequence, value=pb.Object(fields={
                        'LinearX': pb.Value(float64_value=.2),
                        'AngularZ': pb.Value(float64_value=0)})), timeout=.3)
                await asyncio.sleep(.05)
        writer = asyncio.create_task(drive())
        try:
            await asyncio.sleep(.2)
            before = await mock.State(pb.Empty(), timeout=.5)
            assert before.linear_x > .1 and before.mode == 'MANUAL', before
            record('ready', {'state': MessageToDict(before), 'epoch': descriptor.broker_epoch})
            fault = await marker('fault')
            case, started = fault['case'], fault['started']
            deadline = started+1.2
            unavailable = False
            stopped = None
            while time.monotonic() < deadline:
                try:
                    state = await mock.State(pb.Empty(), timeout=.1)
                    if abs(state.linear_x)+abs(state.angular_z) == 0 and not state.motion_active:
                        stopped = state
                        break
                except grpc.aio.AioRpcError:
                    unavailable = True
                    if case == 'provider-restart':
                        break
                await asyncio.sleep(.01)
            if case != 'provider-restart':
                assert stopped is not None, 'provider failed to stop within 1.2 seconds'
            else:
                assert unavailable, 'killed provider should be unavailable, not falsely confirmed'
            record('safe', {'case': case, 'observedAfterSeconds': time.monotonic()-started,
                'providerUnavailable': unavailable, 'state': MessageToDict(stopped) if stopped else None})
            await marker('restored')
            for attempt in range(100):
                try:
                    state = await mock.State(pb.Empty(), timeout=.2)
                    current = await bus.Describe(pb.Empty(), timeout=.2)
                    if state.connected and current.provider_online:
                        break
                except grpc.aio.AioRpcError:
                    pass
                await asyncio.sleep(.1)
            else:
                raise AssertionError('provider did not reconnect')
            if case == 'broker-restart':
                assert current.broker_epoch != descriptor.broker_epoch
            if case == 'provider-restart':
                assert state.session != before.session and state.mode == 'DISARMED'
            try:
                await bus.RenewLease(lease, timeout=.3)
            except grpc.aio.AioRpcError:
                pass
            else:
                raise AssertionError('old lease survived fault')
            origin = state.x
            for _ in range(20):
                state = await mock.State(pb.Empty(), timeout=.3)
                assert state.mode in ('DISARMED', 'SAFE_STOP') and state.linear_x == 0 and state.angular_z == 0
                assert abs(state.x-origin) < 1e-9, 'motion auto-resumed'
                await asyncio.sleep(.05)
            record('result', {'passed': True, 'case': case, 'final': MessageToDict(state)})
            await asyncio.sleep(60)  # host reads tmpfs evidence before removing the probe
        finally:
            writer.cancel()
            await asyncio.gather(writer, return_exceptions=True)


if __name__ == '__main__':
    try:
        asyncio.run(run())
    except BaseException as error:
        record('result', {'passed': False, 'error': repr(error)})
        time.sleep(60)
        raise

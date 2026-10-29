"""Wire feasibility only: not production broker/robot safety acceptance."""
import asyncio
import time
import unittest
import grpc
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc


class SaturatedWire(rpc.ProviderServicer, rpc.BusServicer):
    def __init__(self):
        self.control_peer = None
        self.safety_peer = None
        self.sent = 0
        self.stop_event = asyncio.Event()

    async def Control(self, request, context):
        self.control_peer = context.peer()
        await context.send_initial_metadata(())
        message = pb.Dispatch(kind=pb.INVOKE, value=pb.Object(fields={
            'TransportTestPayload': pb.Value(string_value='x' * 131072)}))
        for _ in range(1000):
            await context.write(message)
            self.sent += 1

    async def Safety(self, request, context):
        self.safety_peer = context.peer()
        await context.send_initial_metadata(())
        await self.stop_event.wait()
        yield pb.Dispatch(kind=pb.STOP, reason='wire isolation test')

    async def Stop(self, request, context):
        self.stop_event.set()
        return pb.StopReply(requested=True, dispatched=True, robot_confirmed=False)


class SafetyTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_independent_tcp_lane_receives_stop_while_control_is_backpressured(self):
        server = grpc.aio.server()
        fixture = SaturatedWire()
        rpc.add_ProviderServicer_to_server(fixture, server)
        rpc.add_BusServicer_to_server(fixture, server)
        port = server.add_insecure_port('127.0.0.1:0')
        await server.start()
        control_channel = grpc.aio.insecure_channel(f'127.0.0.1:{port}')
        safety_channel = grpc.aio.insecure_channel(f'127.0.0.1:{port}', options=[
            ('grpc.use_local_subchannel_pool', 1)])
        control = safety = None
        try:
            await asyncio.wait_for(asyncio.gather(control_channel.channel_ready(),
                                                  safety_channel.channel_ready()), 5)
            hello = pb.ProviderHello(provider_id='wire-test', session='s', protocol_version='1.1')
            control = rpc.ProviderStub(control_channel).Control(hello)
            safety = rpc.ProviderStub(safety_channel).Safety(hello)
            await asyncio.wait_for(asyncio.gather(control.initial_metadata(), safety.initial_metadata()), 5)
            self.assertNotEqual(fixture.control_peer, fixture.safety_peer,
                                'Separate Python channels must actually use distinct TCP peers')
            # Do not consume Control. Require its completed write count to stall
            # with ordinary commands remaining, rather than merely assuming a queue.
            previous = -1
            for _ in range(30):
                await asyncio.sleep(.1)
                if fixture.sent == previous and 0 < fixture.sent < 1000:
                    break
                previous = fixture.sent
            else:
                self.fail(f'Control did not backpressure with pending writes: {fixture.sent}')
            start = time.monotonic()
            reply = await rpc.BusStub(safety_channel).Stop(pb.StopRequest(reason='test'), timeout=2)
            dispatched = await asyncio.wait_for(safety.read(), 2)
            self.assertTrue(reply.requested and reply.dispatched)
            self.assertFalse(reply.robot_confirmed)
            self.assertEqual(dispatched.kind, pb.STOP)
            self.assertLess(fixture.sent, 1000)
            print(f'Wire-only STOP latency {(time.monotonic()-start)*1000:.3f} ms; '
                  f'{1000-fixture.sent} ordinary writes pending; TCP peers distinct')
        finally:
            if control is not None:
                control.cancel()
            if safety is not None:
                safety.cancel()
            await control_channel.close()
            await safety_channel.close()
            await server.stop(0)

"""Authoritative cancel latch must survive a concurrent completed progress ACK."""
import asyncio
import unittest
from provider import ProviderClient
from protobus.v1 import protobus_pb2 as pb


class CancelLatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancel_recorded_during_ack_cannot_continue_backend_body(self):
        phases=[];continued=[];recovered=[]
        class Backend:
            async def command(self,path,args,progress,*,execution_id=None):
                try:
                    await progress(pb.RUNNING)
                    continued.append(True)
                    return pb.SUCCEEDED,'must not happen',True
                except asyncio.CancelledError:
                    recovered.append(True)
                    return pb.CANCELLED,'explicit unit recovery',True
            def request_stop(self):raise AssertionError('unexpected backend exception')
        client=ProviderClient('unused:1',{'nodes':{'Robot.Motion.Perform':{'args':{}}}},Backend())
        async def feedback(message,phase,reason='',confirmed=False):
            phases.append(phase)
            if phase==pb.RUNNING:
                # Deliberately simulate an ACK completing after cancellation was
                # latched, without relying on a nondeterministic Task.cancel race.
                client.cancel_requests.add(message.execution_id)
                client.cancel_causes[message.execution_id]='USER_CANCEL'
        client.feedback=feedback
        await client.run_command(pb.Dispatch(execution_id='unit',path='Robot.Motion.Perform'))
        self.assertEqual(phases,[pb.RUNNING,pb.CANCELLED])
        self.assertFalse(continued);self.assertEqual(recovered,[True])
        self.assertFalse(client.cancel_requests);self.assertFalse(client.cancel_causes)

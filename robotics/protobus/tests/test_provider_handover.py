"""Physical body release is distinct from waiting for the terminal transport ACK."""
import asyncio
import time
import unittest
from provider import ProviderClient,AuthorityGuard
from protobus.v1 import protobus_pb2 as pb

class HandoverTests(unittest.IsolatedAsyncioTestCase):
 async def exercise(self,confirmed,cancel=False):
  calls=[];phases=[];terminal=asyncio.Event();ack=asyncio.Event();second=asyncio.Event()
  class Backend:
   async def command(self,path,args,progress,*,execution_id=None):
    calls.append(execution_id);return pb.SUCCEEDED if confirmed else pb.FAILED,'unit physical result',confirmed
   def request_stop(self):raise AssertionError('unexpected stop')
  client=ProviderClient('unused:1',{'nodes':{'Robot.Safety.Arm':{'args':{}}}},Backend())
  client.guard=AuthorityGuard('b','p');client.guard.fence=1;client.guard.lease_deadline=time.monotonic_ns()+3_000_000_000
  async def feedback(message,phase,reason='',confirmed=False):
   phases.append((message.execution_id,phase))
   if message.execution_id=='one':terminal.set();await ack.wait()
   else:second.set()
  client.feedback=feedback
  def message(identity):return pb.Dispatch(kind=pb.INVOKE,broker_epoch='b',provider_session='p',fence=1,execution_id=identity,path='Robot.Safety.Arm',deadline_monotonic_ns=time.monotonic_ns()+1_000_000_000)
  async def stream():
   yield message('one');await terminal.wait()
   if cancel:client.cancel_command('one','USER_CANCEL')
   yield message('two');await second.wait();ack.set()
  try:
   with self.assertRaises(ConnectionError):await asyncio.wait_for(client.control_loop(stream()),1)
  finally:
   ack.set();await asyncio.gather(*list(client.commands.values()),return_exceptions=True)
  return calls,phases
 async def test_confirmed_body_allows_next_dispatch_while_terminal_ack_is_pending(self):
  calls,phases=await self.exercise(True)
  self.assertEqual(calls,['one','two'])
  self.assertNotIn(('two',pb.REJECTED),phases)
 async def test_unconfirmed_body_stays_busy_while_terminal_ack_is_pending(self):
  calls,phases=await self.exercise(False)
  self.assertEqual(calls,['one']);self.assertIn(('two',pb.REJECTED),phases)

 async def test_late_cancel_does_not_contradict_confirmed_terminal_waiting_for_ack(self):
  calls,phases=await self.exercise(True,cancel=True)
  self.assertEqual(calls,['one','two'])
  self.assertNotIn(('one',pb.CANCELLED),phases)

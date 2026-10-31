"""Control lifecycle units against explicit fake gRPC; no ROS/physics claims."""
import asyncio
import json
from pathlib import Path
import unittest
import time

import grpc
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc
from rfrt.bus import BusClient
from rfrt.core import AuthorityLost,RunStopped,Context,Outcome,Trace
from rfrt.transport import BusTransport,TargetBinding
import test_transport


class FakeControl(test_transport.FakeServer):
    def __init__(self,catalog):
        super().__init__(catalog);self.acquires=0;self.invocations=0;self.stops=0;self.bad_renew=False
        self.holds={};self.target_calls=[];self.release_never_confirm=False;self.mode='MANUAL'
        self.block_command=False;self.command_ready=asyncio.Event();self.command_cancelled=asyncio.Event();self.cancelled_at=None
        self.delay_identity=False
        self.stop_unconfirmed=False
    async def AcquireLease(self,request,context):
        self.acquires+=1
        return pb.Lease(token='unit-secret-token',fence=1,broker_epoch='broker1',client_id=request.client_id,remaining_ms=1000)
    async def RenewLease(self,request,context):
        result=pb.Lease();result.CopyFrom(request);result.remaining_ms=1000
        if self.bad_renew:result.fence+=1
        return result
    async def Invoke(self,request,context):
        self.invocations+=1
        self.command_path=request.path
        identity='unit-command-'+str(self.invocations);self.command_identity=identity
        if self.delay_identity:
            self.command_ready.set();await asyncio.Event().wait()
        for phase in (pb.PENDING,pb.ACCEPTED):
            yield pb.CommandUpdate(path=request.path,execution_id=identity,provider_session='provider1',phase=phase,
                physical_confirmed=phase==pb.SUCCEEDED)
        if self.block_command:
            self.command_ready.set();await self.command_cancelled.wait();await asyncio.sleep(.03)
        yield pb.CommandUpdate(path=request.path,execution_id=identity,provider_session='provider1',
            phase=pb.CANCELLED if self.block_command else pb.SUCCEEDED,physical_confirmed=True)
    async def Cancel(self,request,context):
        self.cancelled_at=time.monotonic();self.command_cancelled.set();return pb.Reply(ok=True)
    async def Stop(self,request,context):
        self.stops+=1
        if self.block_command:
            self.cancelled_at=time.monotonic();self.command_cancelled.set()
        return pb.StopReply(requested=True,dispatched=True,robot_confirmed=not self.stop_unconfirmed,execution_id='unit-stop',
            broker_epoch='broker1',provider_session='provider1')
    async def Get(self,request,context):
        result=await super().Get(request,context)
        for sample in result.samples:
            if sample.path.startswith('Robot.Connection.'):
                sample.value.CopyFrom(pb.Value(bool_value=True));sample.source_epoch='broker1'
            if sample.path=='Robot.Safety.Mode':sample.value.CopyFrom(pb.Value(string_value=self.mode))
        return result
    async def SetTarget(self,request,context):
        now=time.monotonic()
        if request.owner_id not in self.holds:
            self.holds[request.owner_id]=dict(id='unit-hold-'+str(len(self.holds)),owner=request.owner_id,
                first=now,admit=now+.12,release=None,seq=0,path=request.path)
        record=self.holds[request.owner_id];record['seq']=request.sequence
        if request.release:record['release']=record['release'] or now
        self.target_calls.append((now,pb.Target.FromString(request.SerializeToString())))
        return pb.Reply(ok=True,operation_id=record['id'])
    async def InspectExecution(self,request,context):
        if request.execution_id=='unit-stop':
            return pb.ExecutionState(execution_id='unit-stop',path='Robot.Safety.Stop',broker_epoch='broker1',
                provider_session='provider1',logical_phase=pb.ACCEPTED)
        if request.execution_id.startswith('unit-command-'):
            released=self.cancelled_at is not None and time.monotonic()-self.cancelled_at>=.03
            return pb.ExecutionState(execution_id=request.execution_id,path=self.command_path,broker_epoch='broker1',
                provider_session='provider1',fence=1,physical_released=released,
                logical_phase=pb.CANCELLED if released else pb.RUNNING,physical_phase=pb.CANCELLED if released else 0)
        record=next(item for item in self.holds.values() if item['id']==request.execution_id)
        now=time.monotonic();released=bool(record['release'] and now>=record['release']+.03 and not self.release_never_confirm)
        return pb.ExecutionState(execution_id=record['id'],path=record['path'],broker_epoch='broker1',provider_session='provider1',
            owner_id=record['owner'],fence=1,last_sequence=record['seq'],accepted_sequence=record['seq'] if now>=record['admit'] else 0,
            release_requested=record['release'] is not None,physical_released=released,
            logical_phase=pb.SUCCEEDED if released else pb.RUNNING,physical_phase=pb.SUCCEEDED if released else pb.PHASE_UNSPECIFIED)


class BusTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.catalog=json.loads(Path('/contracts/fixtures/rss-go2-catalog.v1.json').read_text())
        self.fake=FakeControl(self.catalog);self.server=grpc.aio.server()
        rpc.add_BusServicer_to_server(self.fake,self.server)
        port=self.server.add_insecure_port('127.0.0.1:0');await self.server.start()
        self.events=[]
        self.client=BusClient(BusTransport(f'127.0.0.1:{port}',self.catalog,TargetBinding.record(self.fake.descriptor),'unit-host'),
            Trace({},self.events.append))
    async def asyncTearDown(self):
        try:
            if self.client is not None:await self.client.close()
        finally:await self.server.stop(0)

    async def test_open_requires_explicit_control_and_never_arms(self):
        await self.client.open(False)
        self.assertEqual(self.fake.acquires,0);self.assertEqual(self.fake.invocations,0)
        with self.assertRaises(AuthorityLost):await self.client.invoke('Robot.Safety.Disarm',{},1000)

    async def test_explicit_lease_executes_correlated_command_and_never_logs_token(self):
        await self.client.open(True)
        result=await self.client.invoke('Robot.Safety.Disarm',{},1000)
        self.assertTrue(result.ok and result.physical_confirmed)
        self.assertEqual(self.fake.acquires,1);self.assertEqual(self.fake.invocations,1)
        self.assertNotIn('unit-secret-token',json.dumps(self.events))

    async def test_failed_renewal_stops_once_and_never_reacquires_or_replays(self):
        await self.client.open(True);self.fake.bad_renew=True
        await asyncio.sleep(.3)
        self.assertTrue(self.client.fault)
        with self.assertRaises(AuthorityLost):await self.client.invoke('Robot.Safety.Disarm',{},1000)
        self.assertEqual(self.fake.acquires,1);self.assertEqual(self.fake.invocations,0)
        await self.client.stop(1000);await self.client.stop(1000)
        self.assertEqual(self.fake.stops,1)

    async def test_expected_cancel_does_not_hide_failed_cleanup(self):
        original=Outcome('CANCELLED',expected_cancel=True)
        self.assertIs(Context.combine(original,Outcome('SUCCEEDED')),original)
        failure=Outcome('FAILED','cleanup failed')
        self.assertIs(Context.combine(original,failure),failure)

    async def test_hold_duration_begins_after_admission_refreshes_and_confirms_safe_release(self):
        await self.client.open(True)
        result=await self.client.hold('Robot.Motion.Velocity',{'LinearX':.2,'AngularZ':0.},100,1500)
        self.assertTrue(result.ok and result.physical_confirmed)
        calls=self.fake.target_calls
        self.assertGreaterEqual(len(calls),4)
        self.assertGreaterEqual(calls[-1][0]-calls[0][0],.21)
        self.assertTrue(calls[-1][1].release)
        self.assertEqual(calls[-1][1].value.fields['LinearX'].float64_value,0.)
        sequences=[request.sequence for _,request in calls]
        self.assertEqual(sequences,sorted(set(sequences)))
        releases=[event for event in self.events if event['event']=='target_release_result']
        self.assertEqual(len(releases),1)
        self.assertEqual(releases[0]['data']['executionId'],result.execution_id)
        self.assertTrue(releases[0]['data']['physicalConfirmed'])
        self.assertEqual(releases[0]['data']['ownerId'],calls[-1][1].owner_id)

    async def test_unconfirmed_release_never_succeeds_or_admits_next_motion(self):
        await self.client.open(True);self.fake.release_never_confirm=True
        result=await self.client.hold('Robot.Motion.Velocity',{'LinearX':.2,'AngularZ':0.},20,300)
        self.assertFalse(result.ok);self.assertFalse(result.physical_confirmed)
        with self.assertRaises(AuthorityLost):await self.client.invoke('Robot.Safety.Disarm',{},1000)

    async def test_cancelled_hold_confirms_release_before_handover_without_rearming(self):
        await self.client.open(True)
        task=asyncio.create_task(self.client.hold('Robot.Motion.Velocity',{'LinearX':.2,'AngularZ':0.},1000,2000))
        await asyncio.sleep(.2)
        result=await self.client.cancel_body(500)
        stopped=await task
        self.assertTrue(result.ok and result.physical_confirmed)
        self.assertEqual(stopped.phase,'CANCELLED');self.assertTrue(stopped.expected_cancel)
        self.assertIsNone(self.client.fault)
        self.assertEqual(self.fake.acquires,1)

    async def test_structural_command_cancellation_keeps_stream_until_release_and_retains_lease(self):
        await self.client.open(True);self.fake.block_command=True
        task=asyncio.create_task(self.client.invoke('Robot.Safety.Disarm',{},1000))
        await asyncio.wait_for(self.fake.command_ready.wait(),.5)
        await asyncio.wait_for(self.client.active_ready.wait(),.5);task.cancel()
        with self.assertRaises(asyncio.CancelledError):await task
        self.assertIsNone(self.client.fault)
        self.assertTrue(self.fake.command_cancelled.is_set())
        self.assertEqual(self.fake.stops,0,'confirmed structural cancel must not silently Stop another branch')

    async def test_cancel_before_execution_identity_fails_safe_instead_of_guessing(self):
        await self.client.open(True);self.fake.delay_identity=True
        task=asyncio.create_task(self.client.invoke('Robot.Safety.Disarm',{},1000))
        await asyncio.wait_for(self.fake.command_ready.wait(),.5);task.cancel()
        with self.assertRaises(asyncio.CancelledError):await task
        self.assertTrue(self.client.fault)
        await self.client.stop(1000);self.assertEqual(self.fake.stops,1)

    async def test_explicit_command_cancel_returns_expected_correlated_cancellation(self):
        await self.client.open(True);self.fake.block_command=True
        task=asyncio.create_task(self.client.invoke('Robot.Safety.Disarm',{},1000))
        await asyncio.wait_for(self.fake.command_ready.wait(),.5)
        cancelled=await self.client.cancel_body(500);original=await task
        self.assertTrue(cancelled.ok and cancelled.physical_confirmed)
        self.assertEqual(original.phase,'CANCELLED');self.assertTrue(original.expected_cancel)
        self.assertIsNone(self.client.fault)

    async def test_confirmed_global_stop_does_not_become_spurious_command_cleanup_fault(self):
        await self.client.open(True);self.fake.block_command=True
        task=asyncio.create_task(self.client.invoke('Robot.Safety.Disarm',{},1000))
        await asyncio.wait_for(self.fake.command_ready.wait(),.5)
        await asyncio.wait_for(self.client.active_ready.wait(),.5)
        await self.client.stop(500);task.cancel()
        with self.assertRaises(asyncio.CancelledError):await task
        self.assertIsNone(self.client.fault);self.assertEqual(self.fake.stops,1)

    async def test_one_shot_primitive_never_leaves_background_target(self):
        await self.client.open(True)
        result=await self.client.set_target('Robot.Motion.Velocity',{'LinearX':.2,'AngularZ':0.})
        self.assertTrue(result.ok and result.physical_confirmed)
        self.assertTrue(self.fake.target_calls[-1][1].release)
        self.assertEqual(self.fake.target_calls[-1][1].value.fields['LinearX'].float64_value,0.)

    async def test_shutdown_never_reports_success_from_unconfirmed_stop_receipt(self):
        await self.client.open(True);self.fake.stop_unconfirmed=True
        result=await self.client.stop(50)
        self.assertFalse(result.ok);self.assertFalse(result.physical_confirmed)
        with self.assertRaises(AuthorityLost) as failure:await self.client.check()
        self.assertNotIsInstance(failure.exception,RunStopped)
        with self.assertRaises(AuthorityLost):await self.client.close()
        self.client=None
        self.assertEqual(self.fake.stops,1)

    async def test_atomic_values_reject_partial_or_out_of_range_before_rpc(self):
        fields=self.catalog['nodes']['Robot.Motion.Velocity']['fields']
        for value in ({'LinearX':.2},{'LinearX':100.,'AngularZ':0.},{'LinearX':True,'AngularZ':0.}):
            with self.subTest(value=value),self.assertRaises(ValueError):self.client.object(value,fields)
        self.assertEqual(self.fake.target_calls,[])

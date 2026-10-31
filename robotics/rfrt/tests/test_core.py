"""Native compiler output with explicit internal fake bus; not ROS conformance."""
import asyncio
import json
from pathlib import Path
import time
import unittest

from rfrt.core import Context,Outcome,Trace,AuthorityLost
from rfrt.values import UNKNOWN,Unavailable


class FakeBus:
    def __init__(self):self.calls=[];self.snapshot={'Robot.Safety.IsStopLatched':False};self.lost=False;self.fail_at=None
    async def check(self):
        if self.lost:raise AuthorityLost('unit-test lease loss')
    async def read(self,paths):return {path:self.snapshot.get(path,UNKNOWN) for path in paths}
    async def invoke(self,path,args,timeout):
        self.calls.append((path,args))
        return Outcome('TIMED_OUT' if len(self.calls)==self.fail_at else 'SUCCEEDED',execution_id=str(len(self.calls)))
    async def stop(self,timeout):self.calls.append(('STOP',{}));return Outcome('SUCCEEDED')
    async def cancel_body(self,timeout):self.calls.append(('CANCEL',{}));return Outcome('SUCCEEDED')


class CoreTests(unittest.IsolatedAsyncioTestCase):
    def context(self,name='RW-B'):
        data=json.loads((Path('/fixtures')/(name+'.json')).read_text())
        files=data['files'];catalog=json.loads(files['rss-catalog.json'])
        namespace={};exec(compile(files['app/flow.py'],'verified-unit-fixture-flow.py','exec'),namespace)
        events=[];bus=FakeBus();trace=Trace(namespace['FLOW_META'],events.append,run_id='unit-run')
        ctx=Context(bus,catalog,{},json.loads(files['units.v1.json']),trace,time.monotonic()+5)
        return ctx,bus,events,namespace

    async def test_actual_generated_patrol_native_loops_visit_six_waypoints_and_disarm(self):
        ctx,bus,events,app=self.context()
        start=next(item for item in app['BEHAVIORS'] if item['trigger']['kind']=='start')
        result=await start['handler'](ctx)
        self.assertTrue(result.ok)
        self.assertEqual([path for path,args in bus.calls],['Robot.Safety.Arm']+['Robot.Navigation.GoTo']*6+['Robot.Safety.Disarm'])
        goals=[args for path,args in bus.calls if path=='Robot.Navigation.GoTo']
        self.assertEqual([(goal['X'],goal['Y']) for goal in goals],[(.8,0.),(-.8,0.),(0.,0.)]*2)
        self.assertEqual([event['data']['index'] for event in events if event['event']=='iteration_started'],[0,1])
        starts={event['seq']:event for event in events if event['event']=='node_started'}
        ends=[event for event in events if event['event']=='node_finished']
        self.assertEqual(set(starts),{event['data']['span'] for event in ends})
        self.assertTrue(all(event['nodeId']==starts[event['data']['span']]['nodeId'] for event in ends))
        self.assertTrue(all(event['nodeId'] for event in events if event['event']=='log'))

    async def test_generated_failure_aborts_remaining_patrol_and_preserves_timeout_after_stop_cleanup(self):
        ctx,bus,events,app=self.context();bus.fail_at=3
        handler=next(item['handler'] for item in app['BEHAVIORS'] if item['trigger']['kind']=='start')
        result=await handler(ctx)
        self.assertEqual(result.phase,'TIMED_OUT')
        self.assertEqual([path for path,args in bus.calls],['Robot.Safety.Arm','Robot.Navigation.GoTo','Robot.Navigation.GoTo','STOP'])
        self.assertFalse(any(event['event']=='log' and event['data']['level']=='info' for event in events))

    async def test_unknown_condition_cannot_choose_generated_reset_or_arm_branch(self):
        ctx,bus,events,app=self.context('RW-C');bus.snapshot.clear()
        with self.assertRaises(Unavailable):await app['BEHAVIORS'][0]['handler'](ctx)
        self.assertEqual(bus.calls,[])
        self.assertTrue(any(event['event']=='node_finished' and event['data']['phase']=='FAILED' for event in events))

    async def test_stop_remains_independent_after_deadline_or_lease_loss(self):
        ctx,bus,events,app=self.context();bus.lost=True;ctx.deadline=time.monotonic()-1
        with self.assertRaises(AuthorityLost):await ctx.checkpoint()
        self.assertTrue((await ctx.stop(100)).ok)
        self.assertEqual(bus.calls,[('STOP',{})])

    async def test_wait_until_unknown_times_out_and_fresh_true_succeeds(self):
        ctx,bus,events,app=self.context()
        condition={'kind':'signal','path':'Robot.Safety.IsArmed','type':'bool'}
        self.assertEqual((await ctx.wait_until(condition,40)).phase,'TIMED_OUT')
        bus.snapshot['Robot.Safety.IsArmed']=True
        self.assertTrue((await ctx.wait_until(condition,40)).ok)

    async def test_parallel_any_awaits_losing_cleanup_before_continuation(self):
        ctx,bus,events,app=self.context();order=[];started=asyncio.Event()
        async def winner(context):await started.wait();return Outcome('SUCCEEDED')
        async def loser(context):
            try:started.set();await asyncio.sleep(1)
            finally:await asyncio.sleep(.02);order.append('cleanup')
        result=await ctx.parallel([winner,loser],'any');order.append('continued')
        self.assertTrue(result.ok);self.assertEqual(order,['cleanup','continued'])

    async def test_parallel_failure_and_loser_cleanup_failure_cannot_become_success(self):
        ctx,bus,events,app=self.context();started=asyncio.Event()
        async def failure(context):return Outcome('FAILED','unit failure')
        async def success(context):return Outcome('SUCCEEDED')
        self.assertEqual((await ctx.parallel([failure,success],'all')).phase,'FAILED')
        async def winner(context):await started.wait();return Outcome('SUCCEEDED')
        async def broken_cleanup(context):
            try:started.set();await asyncio.sleep(1)
            finally:raise RuntimeError('cleanup failed')
        with self.assertRaisesRegex(RuntimeError,'cleanup failed'):await ctx.parallel([winner,broken_cleanup],'any')

    async def test_repeated_parent_cancellation_cannot_detach_parallel_cleanup(self):
        ctx,bus,events,app=self.context();started=asyncio.Event();cleaned=[]
        async def child(context):
            try:started.set();await asyncio.sleep(1)
            finally:await asyncio.sleep(.03);cleaned.append(True)
        task=asyncio.create_task(ctx.parallel([child,child],'any'))
        await started.wait();task.cancel();await asyncio.sleep(.005);task.cancel()
        with self.assertRaises(asyncio.CancelledError):await task
        self.assertEqual(cleaned,[True,True])

    async def test_expected_cancel_is_benign_only_after_confirmed_release(self):
        ctx,bus,events,app=self.context()
        async def okay(context):return Outcome('SUCCEEDED')
        async def released(context):return Outcome('CANCELLED',physical_confirmed=True,expected_cancel=True)
        async def unknown(context):return Outcome('CANCELLED',expected_cancel=True)
        self.assertTrue((await ctx.parallel([okay,released],'all')).ok)
        self.assertEqual((await ctx.parallel([okay,unknown],'all')).phase,'CANCELLED')

import asyncio
import time
import unittest

from rfrt.core import Outcome
from rfrt.engine import Engine
import test_core


def behavior(handler,trigger=None,policy='drop',queue=1):
    return dict(id='behavior',src={'nodeId':'behavior'},trigger=trigger or {'kind':'event','name':'jump'},
        concurrency=policy,queueMax=queue,handler=handler)


class EngineTests(unittest.IsolatedAsyncioTestCase):
    def context(self):return test_core.CoreTests().context()

    async def shutdown(self,task):
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):await task

    async def test_engine_runs_actual_generated_patrol_once_only_after_explicit_launch(self):
        ctx,bus,events,app=self.context()
        start=next(item for item in app['BEHAVIORS'] if item['trigger']['kind']=='start')
        engine=Engine(ctx,[start])
        self.assertFalse(bus.calls);self.assertFalse(events)
        self.assertTrue((await engine.run()).ok)
        self.assertEqual(len(bus.calls),8)
        self.assertEqual(events[0]['event'],'run_started')
        self.assertEqual(events[-1]['event'],'run_finished')
        with self.assertRaises(RuntimeError):await engine.run()

    async def test_condition_requires_continuously_fresh_true_and_fresh_false_to_rearm(self):
        ctx,bus,events,app=self.context();calls=[]
        async def handler(context):calls.append(time.monotonic());return Outcome('SUCCEEDED')
        trigger={'kind':'condition','condition':{'kind':'signal','path':'Robot.Safety.IsArmed','type':'bool'},'forMs':50}
        engine=Engine(ctx,[behavior(handler,trigger)],poll_seconds=.005);task=asyncio.create_task(engine.run())
        await asyncio.sleep(.02);self.assertFalse(calls)
        bus.snapshot['Robot.Safety.IsArmed']=True;await asyncio.sleep(.025)
        bus.snapshot.pop('Robot.Safety.IsArmed');await asyncio.sleep(.025)
        bus.snapshot['Robot.Safety.IsArmed']=True;await asyncio.sleep(.025);self.assertFalse(calls)
        await asyncio.sleep(.04);self.assertEqual(len(calls),1)
        bus.snapshot.pop('Robot.Safety.IsArmed');await asyncio.sleep(.02)
        bus.snapshot['Robot.Safety.IsArmed']=True;await asyncio.sleep(.07);self.assertEqual(len(calls),1)
        bus.snapshot['Robot.Safety.IsArmed']=False;await asyncio.sleep(.02)
        bus.snapshot['Robot.Safety.IsArmed']=True;await asyncio.sleep(.07);self.assertEqual(len(calls),2)
        await self.shutdown(task)

    async def test_event_replay_unknown_name_and_drop_policy_cannot_duplicate_active_work(self):
        ctx,bus,events,app=self.context();entered=asyncio.Event();release=asyncio.Event();calls=[]
        async def handler(context):calls.append(True);entered.set();await release.wait();return Outcome('SUCCEEDED')
        engine=Engine(ctx,[behavior(handler)]);task=asyncio.create_task(engine.run());await asyncio.sleep(0)
        self.assertTrue(engine.event('jump','1'));await entered.wait()
        self.assertFalse(engine.event('jump','1'));self.assertFalse(engine.event('jump','2'))
        with self.assertRaises(ValueError):engine.event('unknown','3')
        release.set();await asyncio.sleep(.02);self.assertEqual(calls,[True])
        self.assertFalse(engine.event('jump','2'),'dropped event identity is still consumed')
        await self.shutdown(task)

    async def test_queue_is_bounded_and_restart_waits_for_old_cleanup_without_double_cancel(self):
        for policy in ('queue','restart'):
            with self.subTest(policy=policy):
                ctx,bus,events,app=self.context();order=[];entered=asyncio.Event();release=asyncio.Event()
                async def handler(context):
                    index=sum(item.startswith('start') for item in order);order.append('start'+str(index));entered.set()
                    try:await release.wait()
                    finally:await asyncio.sleep(.03);order.append('end'+str(index))
                    return Outcome('SUCCEEDED')
                engine=Engine(ctx,[behavior(handler,policy=policy,queue=1)]);task=asyncio.create_task(engine.run())
                await asyncio.sleep(0);engine.event('jump','1');await entered.wait()
                self.assertTrue(engine.event('jump','2'))
                if policy=='queue':self.assertFalse(engine.event('jump','3'))
                else:
                    await asyncio.sleep(.005);self.assertTrue(engine.event('jump','3'))
                release.set();await asyncio.sleep(.09)
                self.assertEqual(order,['start0','end0','start1','end1'])
                await self.shutdown(task)

    async def test_lease_loss_dispatches_stop_before_waiting_for_active_cleanup(self):
        ctx,bus,events,app=self.context();entered=asyncio.Event();cleanup=asyncio.Event()
        async def handler(context):
            try:entered.set();await asyncio.sleep(1)
            finally:
                self.assertIn(('STOP',{}),bus.calls)
                await asyncio.sleep(.02);cleanup.set()
        engine=Engine(ctx,[behavior(handler,{'kind':'start'})],poll_seconds=.005)
        task=asyncio.create_task(engine.run());await entered.wait();bus.lost=True
        result=await asyncio.wait_for(task,.5)
        self.assertEqual(result.phase,'FAILED');self.assertTrue(cleanup.is_set())
        self.assertEqual(bus.calls,[('STOP',{})])

    async def test_periodic_trigger_skips_missed_ticks_without_burst_replay(self):
        ctx,bus,events,app=self.context();calls=[]
        async def handler(context):calls.append(time.monotonic());return Outcome('SUCCEEDED')
        engine=Engine(ctx,[behavior(handler,{'kind':'every','ms':20})],poll_seconds=.005)
        task=asyncio.create_task(engine.run());await asyncio.sleep(.05)
        before=len(calls);time.sleep(.08) # Deliberately stall the owner loop.
        await asyncio.sleep(.008)
        self.assertLessEqual(len(calls)-before,1)
        await self.shutdown(task)

    async def test_on_change_ignores_initial_value_and_unchanged_capture_refresh(self):
        ctx,bus,events,app=self.context();calls=[]
        async def handler(context):calls.append(True);return Outcome('SUCCEEDED')
        path='Robot.Safety.IsArmed';bus.snapshot[path]=False
        engine=Engine(ctx,[behavior(handler,{'kind':'change','path':path})],poll_seconds=.005)
        task=asyncio.create_task(engine.run());await asyncio.sleep(.03);self.assertFalse(calls)
        bus.snapshot[path]=False;await asyncio.sleep(.02);self.assertFalse(calls)
        bus.snapshot[path]=True;await asyncio.sleep(.02);self.assertEqual(len(calls),1)
        bus.snapshot.pop(path);await asyncio.sleep(.02);self.assertEqual(len(calls),1)
        bus.snapshot[path]=True;await asyncio.sleep(.02);self.assertEqual(len(calls),1)
        await self.shutdown(task)

    async def test_global_deadline_stops_active_behavior_and_cannot_auto_resume(self):
        ctx,bus,events,app=self.context();ctx.deadline=time.monotonic()+.04
        async def handler(context):await asyncio.sleep(1);return Outcome('SUCCEEDED')
        engine=Engine(ctx,[behavior(handler,{'kind':'start'})],poll_seconds=.005)
        result=await asyncio.wait_for(engine.run(),.5)
        self.assertEqual(result.phase,'TIMED_OUT');self.assertEqual(bus.calls,[('STOP',{})])
        self.assertFalse(engine.activate('behavior'))

"""Actual nonroot child lifecycle tests; safety callback here is explicitly synthetic."""
import asyncio,json,os,sys,time,unittest
from supervisor import Supervisor,Busy,MAX_LOG_BYTES,MAX_LOG_LINES

ENV={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/tmp','LANG':'C.UTF-8','PYTHONUNBUFFERED':'1'}

class SupervisorTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.safety=asyncio.Event();self.calls=0
        async def safe():self.calls+=1;self.safety.set();return {'confirmed':True,'scope':'unit fixture'}
        self.runner=Supervisor(safe)
    async def asyncTearDown(self):
        if self.runner.phase in ('RUNNING','STOPPING'):await self.runner.stop()
    async def wait_line(self,text):
        end=time.monotonic()+5
        while not any(text in line['text'] for line in self.runner.entries()):
            self.assertLess(time.monotonic(),end,'child output timeout');await asyncio.sleep(.01)
    async def test_nonroot_limits_clean_environment_and_closed_resource_budget(self):
        code="import json,os,resource; print(json.dumps({'uid':os.getuid(),'fds':resource.getrlimit(resource.RLIMIT_NOFILE),'cpu':resource.getrlimit(resource.RLIMIT_CPU),'as':resource.getrlimit(resource.RLIMIT_AS),'secret':os.getenv('UNIT_SECRET')}))"
        await self.runner.start([sys.executable,'-I','-c',code],ENV)
        result=await asyncio.wait_for(self.runner.finished,5)
        value=json.loads(self.runner.entries()[0]['text'])
        self.assertNotEqual(value['uid'],0);self.assertEqual(value['fds'],[128,128])
        self.assertEqual(value['cpu'],[300,301]);self.assertEqual(value['as'],[8*1024**3]*2)
        self.assertIsNone(value['secret']);self.assertEqual(result['phase'],'STOPPED');self.assertEqual(self.calls,1)
    async def test_second_run_refused_and_safety_starts_before_hung_child_is_killed(self):
        code="import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);print('READY',flush=True);time.sleep(60)"
        await self.runner.start([sys.executable,'-I','-c',code],ENV);await self.wait_line('READY')
        with self.assertRaises(Busy):await self.runner.start([sys.executable,'-c','pass'],ENV)
        began=time.monotonic();stopping=asyncio.create_task(self.runner.stop())
        await asyncio.wait_for(self.safety.wait(),.3)
        self.assertIsNone(self.runner.process.returncode,'safety must precede the forced child exit')
        result=await asyncio.wait_for(stopping,5)
        self.assertTrue(result['forced']);self.assertEqual(result['exitCode'],-9)
        self.assertLess(time.monotonic()-began,4.5);self.assertEqual(self.calls,1)
    async def test_output_ring_is_byte_and_count_bounded(self):
        code="for i in range(2500):print(str(i)+':'+('x'*3000))"
        await self.runner.start([sys.executable,'-I','-c',code],ENV)
        await asyncio.wait_for(self.runner.finished,8)
        self.assertLessEqual(self.runner.log_bytes,MAX_LOG_BYTES)
        self.assertLessEqual(len(self.runner.logs),MAX_LOG_LINES)
        self.assertEqual(self.runner.sequence,2500)
        self.assertIn('2499:',self.runner.entries()[-1]['text'])
    async def test_unconfirmed_independent_stop_remains_failed(self):
        async def unavailable():raise ConnectionError('fixture transport down')
        self.runner.ensure_safe=unavailable
        await self.runner.start([sys.executable,'-I','-c','pass'],ENV)
        result=await asyncio.wait_for(self.runner.finished,5)
        self.assertEqual(result['phase'],'FAILED');self.assertFalse(result['safeResult']['confirmed'])
    async def test_event_input_budget_and_stopped_process_rejection(self):
        with self.assertRaises(ValueError):await self.runner.event('x'*2049)
        await self.runner.start([sys.executable,'-I','-c',"import sys;print(sys.stdin.readline().strip())"],ENV)
        await self.runner.event('{"schema":"rfevent.v1","id":"one","name":"jump"}')
        await asyncio.wait_for(self.runner.finished,5)
        self.assertIn('jump',self.runner.entries()[0]['text'])
        with self.assertRaises(ValueError):await self.runner.event('{}')

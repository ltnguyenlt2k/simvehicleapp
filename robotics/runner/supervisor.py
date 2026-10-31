"""Bounded native child lifecycle. Callers supply trusted, fixed-image argv only."""
import asyncio
from collections import deque
import os
from pathlib import Path
import sys
import signal
import time

MAX_LOG_BYTES=4*1024*1024
MAX_LOG_LINES=2000




class Busy(RuntimeError):pass


class Supervisor:
    def __init__(self,ensure_safe):
        self.ensure_safe=ensure_safe
        self.process=None;self.finished=None;self.reader=None
        self.lock=asyncio.Lock();self.logs=deque();self.log_bytes=0
        self.sequence=0;self.phase='IDLE';self.exit_code=None;self.safe_result=None
        self.forced=False;self.started_ns=None;self.output_error=False;self.safety_task=None

    def snapshot(self):
        return dict(phase=self.phase,exitCode=self.exit_code,forced=self.forced,
                    safeResult=self.safe_result,startedMonotonicNs=self.started_ns,
                    logSequence=self.sequence,outputError=self.output_error)

    async def start(self,argv,environment):
        async with self.lock:
            if self.phase in ('RUNNING','STOPPING'):raise Busy('a run already owns this robot')
            self.logs.clear();self.log_bytes=0;self.sequence=0;self.forced=False
            self.safe_result=None;self.output_error=False;self.exit_code=None;self.safety_task=None
            wrapped=[sys.executable,'-I',str(Path(__file__).with_name('limits_exec.py')),*argv]
            self.process=await asyncio.create_subprocess_exec(*wrapped,
                stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,env=environment,cwd='/tmp',
                start_new_session=True,limit=65536)
            self.phase='RUNNING';self.started_ns=time.monotonic_ns()
            self.reader=asyncio.create_task(self._read())
            self.finished=asyncio.create_task(self._finish())
            return self.snapshot()

    async def _read(self):
        try:
            while True:
                raw=await self.process.stdout.readline()
                if not raw:return
                self.sequence+=1
                item=dict(seq=self.sequence,text=raw.decode('utf-8',errors='replace').rstrip())
                size=len(raw)
                self.logs.append((size,item));self.log_bytes+=size
                while self.log_bytes>MAX_LOG_BYTES or len(self.logs)>MAX_LOG_LINES:
                    previous,_=self.logs.popleft();self.log_bytes-=previous
        except (ValueError,UnicodeError):
            self.output_error=True
            self._start_safety()
            self._signal(signal.SIGTERM)
            # A hostile log writer must not keep an undrained pipe/run forever.
            await asyncio.sleep(3)
            if self.process.returncode is None:
                self.forced=True;self._signal(signal.SIGKILL)

    def _start_safety(self):
        if self.safety_task is None:
            async def perform():
                try:return await asyncio.wait_for(self.ensure_safe(),2)
                except Exception:return dict(confirmed=False,reason='independent Stop unavailable')
            self.safety_task=asyncio.create_task(perform())

    async def _finish(self):
        self.exit_code=await self.process.wait()
        self._start_safety()
        await self.reader
        self.safe_result=await asyncio.shield(self.safety_task)
        self.phase=('STOPPED' if self.exit_code==0 and self.safe_result.get('confirmed')
                    else 'FAILED')
        return self.snapshot()

    def _signal(self,value):
        if self.process is not None and self.process.returncode is None:
            try:os.killpg(self.process.pid,value)
            except ProcessLookupError:pass

    async def stop(self):
        if self.phase not in ('RUNNING','STOPPING'):
            return self.snapshot()
        self.phase='STOPPING'
        self._start_safety()
        self._signal(signal.SIGTERM)
        try:return await asyncio.wait_for(asyncio.shield(self.finished),3)
        except asyncio.TimeoutError:
            if self.process.returncode is None:
                self.forced=True;self._signal(signal.SIGKILL)
            return await asyncio.wait_for(asyncio.shield(self.finished),3)

    async def event(self,value):
        raw=(value+'\n').encode()
        if len(raw)>2048:raise ValueError('event exceeds input budget')
        if self.phase!='RUNNING' or self.process.stdin.is_closing():raise ValueError('run is not accepting events')
        self.process.stdin.write(raw)
        await asyncio.wait_for(self.process.stdin.drain(),.5)

    def entries(self,after=0):
        return [item for _,item in self.logs if item['seq']>after]

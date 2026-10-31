"""Explicit-launch behavior scheduling around generated coroutine handlers."""
import asyncio
from collections import deque
from dataclasses import dataclass,field
import time

from .core import AuthorityLost,RunStopped,Outcome,drain
from .values import UNKNOWN,Unavailable


@dataclass
class Slot:
    behavior:dict
    pending:deque=field(default_factory=deque)
    wake:asyncio.Event=field(default_factory=asyncio.Event)
    task:object=None
    restarting:bool=False


class Engine:
    def __init__(self,context,behaviors,poll_seconds=.02):
        self.context=context;self.slots={item['id']:Slot(item) for item in behaviors}
        if len(self.slots)!=len(behaviors):raise ValueError('duplicate behavior identity')
        self.poll_seconds=poll_seconds;self.finished=asyncio.Event();self.closing=False
        self.started=False;self.result=Outcome('SUCCEEDED');self.tasks=[];self.stop_task=None
        self.event_ids=set();self.event_order=deque()
        self.reactive=any(slot.behavior['trigger']['kind']!='start' for slot in self.slots.values())

    def activate(self,identity):
        if not self.started or self.closing or self.finished.is_set():return False
        slot=self.slots[identity];behavior=slot.behavior
        busy=bool(slot.pending) or slot.task is not None
        policy=behavior['concurrency']
        if busy:
            if policy=='drop':return False
            if policy=='queue' and len(slot.pending)>=behavior['queueMax']:return False
            if policy=='restart':
                slot.pending.clear()
                if slot.task is not None and not slot.task.done() and not slot.restarting:
                    slot.restarting=True;slot.task.cancel()
        slot.pending.append(None);slot.wake.set()
        self.context.trace.emit(identity,'behavior_queued',pending=len(slot.pending))
        return True

    def event(self,name,identity):
        if not self.started or self.closing or self.finished.is_set():return False
        if (not isinstance(name,str) or not isinstance(identity,str)
                or not 1<=len(identity)<=128 or not 1<=len(name)<=64):
            raise ValueError('bounded named event and identity required')
        matches=[key for key,slot in self.slots.items()
            if slot.behavior['trigger']=={'kind':'event','name':name}]
        if not matches:raise ValueError('event is not declared by this workflow')
        if identity in self.event_ids:return False
        if len(self.event_order)>=1024:raise ValueError('event identity budget exhausted; explicit new run required')
        self.event_order.append(identity);self.event_ids.add(identity)
        return any([self.activate(key) for key in matches])

    def fail(self,result):
        if self.finished.is_set():return
        self.result=result;self.finished.set()
        # Safety dispatch begins before potentially slow child recovery/draining.
        if self.stop_task is None and not getattr(self.context.bus,'stop_requested',False):
            self.stop_task=asyncio.create_task(self.context.bus.stop(1000))

    async def worker(self,slot):
        identity=slot.behavior['id']
        while True:
            await slot.wake.wait();slot.wake.clear()
            while slot.pending and not self.closing and not self.finished.is_set():
                slot.pending.popleft()
                slot.task=asyncio.create_task(slot.behavior['handler'](self.context))
                self.context.trace.emit(identity,'behavior_started')
                try:
                    result=await asyncio.shield(slot.task)
                    if not isinstance(result,Outcome):raise TypeError('behavior outcome required')
                except asyncio.CancelledError:
                    if self.closing:raise
                    if slot.restarting:result=Outcome('CANCELLED','restarted by explicit trigger policy')
                    else:raise
                except Exception as error:result=Outcome('CANCELLED' if isinstance(error,RunStopped) else 'FAILED',type(error).__name__)
                finally:
                    # Only this worker may replace its owned child, after cleanup.
                    if slot.task is not None and not slot.task.done():
                        if not slot.task.cancelling():slot.task.cancel()
                        await drain([slot.task])
                    slot.task=None
                restarting=slot.restarting;slot.restarting=False
                self.context.trace.emit(identity,'behavior_finished',phase=result.phase,restarted=restarting)
                if not result.ok and not restarting and not (result.expected_cancel and result.physical_confirmed):
                    self.fail(result);return
                if not self.reactive and all(item.task is None and not item.pending for item in self.slots.values()):
                    if getattr(self.context.bus,'fault',None):
                        self.fail(Outcome('FAILED','authority was lost during cleanup'));return
                    self.finished.set();return

    async def watch(self,identity,trigger):
        kind=trigger['kind'];armed=True;true_since=None;previous=UNKNOWN
        interval=trigger.get('ms',0)/1000;next_tick=time.monotonic()+interval
        while not self.closing:
            await self.context.checkpoint()
            if kind=='condition':
                try:value=await self.context.condition(trigger['condition'])
                except Unavailable:value=UNKNOWN
                now=time.monotonic()
                if value is UNKNOWN:true_since=None
                elif not value:armed=True;true_since=None
                elif armed:
                    if true_since is None:true_since=now
                    if now-true_since>=trigger['forMs']/1000:
                        self.activate(identity);armed=False
            elif kind=='change':
                path=trigger['path'];snapshot=await self.context.bus.read([path]);value=snapshot.get(path,UNKNOWN)
                if value is not UNKNOWN:
                    if previous is not UNKNOWN and (type(value) is not type(previous) or value!=previous):self.activate(identity)
                    previous=value
            elif kind=='every':
                now=time.monotonic()
                if now>=next_tick:
                    self.activate(identity)
                    next_tick+=(int((now-next_tick)/interval)+1)*interval
            else:raise ValueError('unknown polled trigger')
            await asyncio.sleep(self.poll_seconds)

    async def monitor(self):
        try:
            while True:
                await self.context.checkpoint();await asyncio.sleep(self.poll_seconds)
        except Exception as error:
            self.fail(Outcome('CANCELLED' if isinstance(error,RunStopped) else 'TIMED_OUT' if time.monotonic()>=self.context.deadline else 'FAILED',type(error).__name__))

    async def guarded_watch(self,identity,trigger):
        try:await self.watch(identity,trigger)
        except Exception as error:self.fail(Outcome('FAILED',type(error).__name__))

    async def run(self):
        """Caller owns BusClient lifecycle and independent process shutdown limit."""
        if self.started:raise RuntimeError('engine cannot resume or run twice')
        self.started=True;self.context.trace.header()
        self.tasks=[asyncio.create_task(self.worker(slot)) for slot in self.slots.values()]
        self.tasks.append(asyncio.create_task(self.monitor()))
        for identity,slot in self.slots.items():
            trigger=slot.behavior['trigger']
            if trigger['kind']=='start':self.activate(identity)
            elif trigger['kind'] in ('condition','change','every'):
                self.tasks.append(asyncio.create_task(self.guarded_watch(identity,trigger)))
        if not self.slots:self.finished.set()
        try:
            await self.finished.wait()
            return self.result
        except BaseException as error:
            self.result=Outcome('CANCELLED' if isinstance(error,asyncio.CancelledError) else 'FAILED',type(error).__name__)
            if self.stop_task is None:self.stop_task=asyncio.create_task(self.context.bus.stop(1000))
            raise
        finally:
            self.closing=True
            for slot in self.slots.values():
                slot.pending.clear()
                if slot.task is not None and not slot.task.done():slot.task.cancel()
            for task in self.tasks:
                if not task.done():task.cancel()
            await drain(self.tasks)
            if self.stop_task is not None:await drain([self.stop_task])
            self.context.trace.emit(None,'run_finished',phase=self.result.phase)

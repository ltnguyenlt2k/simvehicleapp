"""Operations used by generated native Python; no statement IR interpreter."""
import asyncio
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass
import json
import time
import uuid

from .values import Values,UNKNOWN,Unavailable,checked

PHASES=frozenset(('SUCCEEDED','FAILED','REJECTED','CANCELLED','TIMED_OUT'))


class AuthorityLost(RuntimeError):pass


@dataclass(frozen=True)
class Outcome:
    phase:str
    reason:str=''
    physical_confirmed:bool=False
    execution_id:str=''

    def __post_init__(self):
        if self.phase not in PHASES:raise ValueError('unknown operation outcome')
        if type(self.physical_confirmed) is not bool:raise ValueError('physical confirmation must be boolean')

    @property
    def ok(self):return self.phase=='SUCCEEDED'


class Trace:
    def __init__(self,metadata,sink=None,run_id=None):
        self.run_id=run_id or str(uuid.uuid4());self.sequence=0
        self.sink=sink or (lambda event:print('RFTRACE '+json.dumps(event,sort_keys=True,ensure_ascii=False,allow_nan=False),flush=True))
        self.metadata=dict(metadata)
        self.parent=ContextVar('robotflow_span',default=None)
        self.current_node=ContextVar('robotflow_node',default=None)

    def emit(self,node,event,**data):
        self.sequence+=1
        value=dict(schema='rftrace.v1',runId=self.run_id,seq=self.sequence,
            monotonicNs=str(time.monotonic_ns()),nodeId=node if node is not None else self.current_node.get(),event=event,
            parentSpan=self.parent.get(),data=data)
        self.sink(value)
        return self.sequence

    def header(self):self.emit(None,'run_started',identities=self.metadata)


class Step:
    def __init__(self):self.outcome=None;self.details={}
    def result(self,outcome):
        if not isinstance(outcome,Outcome):raise TypeError('typed operation outcome required')
        self.outcome=outcome
    def data(self,**data):self.details.update(data)


async def drain(tasks):
    """Retain structured ownership even if the parent is cancelled repeatedly."""
    completion=asyncio.gather(*tasks,return_exceptions=True)
    while not completion.done():
        try:await asyncio.shield(completion)
        except asyncio.CancelledError:continue
    return completion.result()


def dependencies(node):
    result=set()
    if isinstance(node,dict):
        if node.get('kind')=='signal':result.add(node['path'])
        for value in node.values():result.update(dependencies(value))
    elif isinstance(node,list):
        for value in node:result.update(dependencies(value))
    return result


class Context:
    def __init__(self,bus,catalog,variables,units,trace,deadline):
        self.bus=bus;self.catalog=catalog['nodes'];self.values=Values(catalog,variables,units)
        self.trace=trace;self.deadline=deadline

    @staticmethod
    def success():return Outcome('SUCCEEDED') # Region completion, no physical assertion.

    @staticmethod
    def combine(original,branch):return branch if original.ok else original

    @asynccontextmanager
    async def node(self,identity,operation):
        step=Step();span=self.trace.emit(identity,'node_started',operation=operation)
        token=self.trace.parent.set(span)
        node_token=self.trace.current_node.set(identity)
        try:
            yield step
        except BaseException as error:
            phase='CANCELLED' if isinstance(error,asyncio.CancelledError) else 'FAILED'
            self.trace.emit(identity,'node_finished',span=span,phase=phase,error=type(error).__name__)
            raise
        else:
            result=step.outcome or self.success()
            self.trace.emit(identity,'node_finished',span=span,phase=result.phase,
                physicalConfirmed=result.physical_confirmed,executionId=result.execution_id,**step.details)
        finally:
            self.trace.parent.reset(token)
            self.trace.current_node.reset(node_token)

    @asynccontextmanager
    async def iteration(self,identity,index):
        self.trace.emit(identity,'iteration_started',index=index)
        try:yield
        finally:self.trace.emit(identity,'iteration_finished',index=index)

    async def checkpoint(self):
        if time.monotonic()>=self.deadline:raise AuthorityLost('run deadline expired')
        await self.bus.check()
        await asyncio.sleep(0)

    async def snapshot(self,expression):
        await self.checkpoint()
        paths=sorted(dependencies(expression))
        result=await self.bus.read(paths) if paths else {}
        await self.checkpoint()
        return result

    async def condition(self,expression):
        return self.values.condition(expression,await self.snapshot(expression))

    async def wait(self,milliseconds):
        end=time.monotonic()+milliseconds/1000
        while True:
            await self.checkpoint()
            remaining=end-time.monotonic()
            if remaining<=0:return
            await asyncio.sleep(min(.02,remaining))

    async def wait_until(self,expression,timeout_ms):
        end=time.monotonic()+timeout_ms/1000
        while time.monotonic()<end:
            try:
                matched=await self.condition(expression)
                if matched and time.monotonic()<end:return self.success()
            except Unavailable:pass
            await self.wait(min(20,max(1,int((end-time.monotonic())*1000))))
        return Outcome('TIMED_OUT','condition was not freshly true before deadline')

    async def assign(self,name,expression):
        snapshot=await self.snapshot(expression)
        self.values.assign(name,self.values.evaluate(expression,snapshot))

    async def read(self,path,name):
        await self.checkpoint();snapshot=await self.bus.read([path])
        await self.checkpoint()
        value=self.values.source(snapshot.get(path,UNKNOWN),self.catalog[path])
        self.values.assign(name,value)

    async def log(self,level,parts):
        expressions=[part for part in parts if isinstance(part,dict)]
        paths=sorted(dependencies(expressions))
        snapshot=await self.bus.read(paths) if paths else {}
        rendered=[]
        for part in parts:
            if isinstance(part,str):rendered.append(part)
            else:
                value=self.values.evaluate(part,snapshot)
                rendered.append('unavailable' if value is UNKNOWN else str(value))
        self.trace.emit(None,'log',level=level,message=''.join(rendered)[:8192])

    async def arguments(self,expressions,specs):
        snapshot=await self.snapshot(expressions);result={}
        for name,expression in expressions.items():
            value=self.values.evaluate(expression,snapshot)
            if value is UNKNOWN:raise Unavailable('operation argument is unavailable')
            spec=specs[name]
            if spec['type'] in ('uint8','int32','uint32','int64','float32','float64'):
                value=self.values.convert(value,spec.get('unit','1'),True)
            result[name]=checked(value,spec)
        return result

    async def invoke(self,path,expressions,timeout_ms):
        return await self.bus.invoke(path,await self.arguments(expressions,self.catalog[path]['args']),timeout_ms)

    async def hold(self,path,expressions,duration_ms,timeout_ms):
        return await self.bus.hold(path,await self.arguments(expressions,self.catalog[path]['fields']),duration_ms,timeout_ms)

    async def set_target(self,path,expressions):
        return await self.bus.set_target(path,await self.arguments(expressions,self.catalog[path]['fields']))

    async def cancel_body(self,timeout_ms):
        await self.checkpoint()
        return await self.bus.cancel_body(timeout_ms)

    async def stop(self,timeout_ms):
        # STOP remains callable after lease loss or the ordinary run deadline.
        return await self.bus.stop(timeout_ms)

    async def parallel(self,handlers,mode):
        if mode not in ('all','any') or len(handlers)!=2:raise ValueError('closed parallel mode/arity required')
        tasks=[asyncio.create_task(handler(self)) for handler in handlers]
        try:
            if mode=='all':results=await asyncio.gather(*tasks,return_exceptions=True)
            else:
                done,pending=await asyncio.wait(tasks,return_when=asyncio.FIRST_COMPLETED)
                for task in pending:task.cancel()
                results=await drain(tasks)
                # Cancellation requested for a losing child is structural cleanup.
                results=[result for task,result in zip(tasks,results)
                    if not (task in pending and isinstance(result,asyncio.CancelledError))]
            for result in results:
                if isinstance(result,BaseException):raise result
                if not isinstance(result,Outcome):raise TypeError('child outcome required')
                if not result.ok:return result
            return self.success()
        except BaseException:
            for task in tasks:
                if not task.done():task.cancel()
            await drain(tasks)
            raise

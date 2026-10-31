"""Bounded mock-only experiments against the installed native runtime and broker audit."""
import asyncio,json,math,os,time,uuid
from pathlib import Path
import grpc
from jsonschema import Draft202012Validator
from supervisor import Busy
from google.protobuf.json_format import ParseDict
from protobus.v1 import protobus_pb2 as pb,protobus_pb2_grpc as rpc
from protobus.mock.v1 import mock_pb2 as mpb,mock_pb2_grpc as mrpc

SCHEMA=Path(__file__).parent/'contracts/studio/scenario.v1.json'

def wire(value,node):
    kind=node['type']
    if kind=='bool':
        if type(value) is not bool:raise ValueError('boolean required')
        return {'boolValue':value}
    if kind in ('string','enum'):
        if not isinstance(value,str) or len(value)>256 or kind=='enum' and value not in node['values']:raise ValueError('string/enum required')
        return {'stringValue':value}
    if type(value) not in (int,float) or not math.isfinite(value):raise ValueError('finite number required')
    if kind!='float64' and (type(value) is not int):raise ValueError('integer required')
    if value<node.get('min',-math.inf) or value>node.get('max',math.inf):raise ValueError('number outside catalog range')
    bounds={'uint8':(0,255),'uint32':(0,2**32-1),'uint64':(0,2**64-1),'int32':(-2**31,2**31-1),'int64':(-2**63,2**63-1)}
    if kind in bounds and not bounds[kind][0]<=value<=bounds[kind][1]:raise ValueError('integer outside wire range')
    return {('uint32' if kind=='uint8' else kind)+'Value':value}

def validate(scenario,catalog):
    Draft202012Validator(json.loads(SCHEMA.read_text())).validate(scenario)
    duration=scenario['durationMs']
    for step in scenario['steps']:
        if step['atMs']>duration:raise ValueError('timeline exceeds duration')
        if 'sensor' in step:
            item=step['sensor'];path=item['path'];node=catalog['nodes'].get(path,{})
            if node.get('kind')!='sensor' or node.get('generated') or path.startswith(('Robot.Safety.','Robot.Connection.')):raise ValueError('sensor cannot be injected')
            if item['quality']=='NONE':
                if item['value'] is not None:raise ValueError('NONE has no value')
            else:wire(item['value'],node)
        elif 'commandResult' in step:
            path=step['commandResult']['path'];node=catalog['nodes'].get(path,{})
            if node.get('kind')!='command' or path.startswith('Robot.Safety.'):raise ValueError('command result cannot be forced')
    for expected in scenario['expect']:
        a,b=expected['withinMs']
        if a>b or b>duration:raise ValueError('expectation exceeds duration')
        if expected['kind']!='log':
            node=catalog['nodes'].get(expected['path'],{})
            if node.get('kind')!='command':raise ValueError('expectation requires a catalog command')
            if set(expected['args'])!=set(node['args']):raise ValueError('expectation requires exact command arguments')
            for key,value in expected['args'].items():wire(value,node['args'][key])
    return scenario

def plain(value):
    if value=={}:return {} # protobuf JSON omits an empty struct's fields
    if 'fields' in value:return {key:plain(item) for key,item in value['fields'].items()}
    if len(value)!=1:raise ValueError('invalid audit value')
    key,item=next(iter(value.items()))
    if key in ('uint64Value','int64Value'):return int(item)
    return item

def evaluate(scenario,audit,traces,start_ns,bound):
    invocations={}
    for event in audit:
        if event.get('broker_epoch')!=bound['brokerEpoch'] or str(event.get('fence'))!=str(bound['fence']):continue
        if event.get('event')!='command_phase':continue
        identity=event['execution_id']
        if event['phase']=='PENDING':
            invocations[identity]={'path':event['path'],'args':plain(event['args']),'atMs':(int(event['monotonic_ns'])-start_ns)/1e6,'phases':[]}
        if identity in invocations:invocations[identity]['phases'].append(event['phase'])
    # Priority Stop has its own broker lane; correlate by the native trace's
    # execution identity, never by a coincidental process/network address.
    stop_ids={t['data'].get('executionId') for t in traces if t['event']=='safety_stop_result'}
    for event in audit:
        if event.get('broker_epoch')!=bound['brokerEpoch'] or event.get('execution_id') not in stop_ids:continue
        identity=event['execution_id']
        if event.get('event')=='stop':invocations[identity]={'path':'Robot.Safety.Stop','args':{},'atMs':(int(event['monotonic_ns'])-start_ns)/1e6,'phases':['PENDING']}
        elif event.get('event')=='stop_feedback' and identity in invocations:invocations[identity]['phases'].append(event['phase'])
    logs=[{'atMs':(int(t['monotonicNs'])-start_ns)/1e6,'message':str(t['data'].get('message',''))} for t in traces if t['event']=='log']
    checks=[];previous=-math.inf;tolerance=scenario['toleranceMs']
    for expected in scenario['expect']:
        lo,hi=expected['withinMs'];lo-=tolerance;hi+=tolerance
        if expected['kind']=='log':
            matches=[item for item in logs if lo<=item['atMs']<=hi and expected['contains'] in item['message']]
        else:
            matches=[item for item in invocations.values() if lo<=item['atMs']<=hi and item['path']==expected['path'] and item['args']==expected['args'] and (expected['kind']=='forbid' or expected['phase'] in item['phases'])]
        matches.sort(key=lambda item:item['atMs'])
        forbidden=expected['kind']=='forbid';count=0 if forbidden else expected['count']
        ordered=forbidden or not matches or matches[0]['atMs']>=previous
        passed=len(matches)==count and ordered
        if matches and not forbidden:previous=matches[0]['atMs']
        checks.append({'passed':passed,'expected':expected,'observedCount':len(matches),'ordered':ordered,'timesMs':[round(item['atMs'],3) for item in matches]})
    return checks,list(invocations.values())

class ScenarioTests:
    def __init__(self,runner):
        self.runner=runner;self.task=None;self.report=None
    @property
    def active(self):return self.task is not None and not self.task.done()
    def launch(self,deployment,scenario):
        if self.runner.mode!='sim':raise ValueError('tests exist only on the mock runner')
        if self.active or self.runner.supervisor.phase in ('RUNNING','STOPPING'):raise Busy('another run/test owns this robot')
        validate(scenario,self.runner.catalog)
        self.runner.deployment(deployment)
        self.report={'id':str(uuid.uuid4()),'deploymentId':deployment,'name':scenario['name'],'phase':'RUNNING','checks':[]}
        self.task=asyncio.create_task(self.execute(deployment,scenario))
        return dict(self.report)
    async def cancel(self):
        if self.active:self.task.cancel();await asyncio.gather(self.task,return_exceptions=True)
    def traces(self):
        entries=self.runner.supervisor.entries()
        if entries and entries[0]['seq']!=1:raise ValueError('trace history was truncated')
        result=[]
        for entry in entries:
            if entry['text'].startswith('RFTRACE '):result.append(json.loads(entry['text'][8:]))
        return result
    async def execute(self,deployment,scenario):
        report=self.report;path=Path('/audit/protobus-audit.jsonl');started=False
        try:
            # Open the existing regular audit file; no paths or hosts supplied by a scenario.
            fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
            try:
                import stat
                before=os.fstat(fd)
                if not stat.S_ISREG(before.st_mode):raise ValueError('audit is not regular')
                offset=before.st_size
                async with grpc.aio.insecure_channel('protobus-mock:55601') as channel:
                    control=mrpc.MockControlStub(channel)
                    async with grpc.aio.insecure_channel(self.runner.bus.address) as bus_channel:
                        bus=rpc.BusStub(bus_channel)
                        old=await bus.Describe(pb.Empty(),timeout=2)
                        await control.Reset(mpb.ResetRequest(time_scale=scenario['timeScale']),timeout=2)
                        deadline=time.monotonic()+10
                        while True:
                            current=await bus.Describe(pb.Empty(),timeout=2)
                            if current.provider_online and current.provider_session!=old.provider_session:break
                            if time.monotonic()>deadline:raise ValueError('mock reset did not become ready')
                            await asyncio.sleep(.05)
                    # Only this method can start while the test reservation is held.
                    from service import StartInput
                    await self.runner.start(StartInput(deploymentId=deployment,requestId=str(uuid.uuid4())))
                    started=True;deadline=time.monotonic()+5
                    while True:
                        traces=self.traces();bound_event=next((t for t in traces if t['event']=='bus_bound'),None)
                        if bound_event:break
                        if self.runner.supervisor.phase!='RUNNING' or time.monotonic()>deadline:raise ValueError('native runtime did not bind the mock')
                        await asyncio.sleep(.02)
                    start_ns=int(bound_event['monotonicNs']);bound=bound_event['data']
                    # Scheduling starts after the actual native binding, never at HTTP request time.
                    steps=[]
                    for step in scenario['steps']:
                        if 'event' in step:continue
                        item={'atMs':step['atMs']}
                        if 'sensor' in step:
                            sensor=step['sensor'];item['sensor']={'path':sensor['path'],'quality':sensor['quality']}
                            if sensor['quality']!='NONE':item['sensor']['value']=wire(sensor['value'],self.runner.catalog['nodes'][sensor['path']])
                        else:item['commandResult']=step['commandResult']
                        steps.append(item)
                    if steps:await control.Schedule(ParseDict({'steps':steps},mpb.ScenarioRequest()),timeout=2)
                    pending=sorted([dict(step,id=str(uuid.uuid4())) for step in scenario['steps'] if 'event' in step],key=lambda step:step['atMs'])
                    end=start_ns+scenario['durationMs']*1_000_000
                    while time.monotonic_ns()<end:
                        now=(time.monotonic_ns()-start_ns)/1e6
                        while pending and now>=pending[0]['atMs']:
                            step=pending.pop(0)
                            await self.runner.supervisor.event(json.dumps({'schema':'rfevent.v1','id':step['id'],'name':step['event']}))
                        await asyncio.sleep(.02)
                    # Negative expectations always observe the full declared horizon.
                    await self.runner.supervisor.stop()
                    safe=await self.runner.bus.stop()
                    report['safety']=safe
                    after=os.fstat(fd);current_stat=path.stat()
                    if after.st_ino!=current_stat.st_ino or after.st_size<offset or after.st_size-offset>8*1024*1024:raise ValueError('audit rotated/truncated/exceeded test budget')
                    os.lseek(fd,offset,os.SEEK_SET);raw=os.read(fd,8*1024*1024+1)
                    if raw and not raw.endswith(b'\n'):raise ValueError('incomplete audit record')
                    audit=[json.loads(line) for line in raw.splitlines()]
                    traces=self.traces()
                    checks,invocations=evaluate(scenario,audit,traces,start_ns,bound)
                    report.update(checks=checks,observedInvocations=invocations,observedTraceCount=len(traces),observedDurationMs=(time.monotonic_ns()-start_ns)/1e6,
                        phase='PASS' if safe.get('confirmed') and all(check['passed'] for check in checks) else 'FAIL')
            finally:os.close(fd)
        except asyncio.CancelledError:report.update(phase='CANCELLED',reason='operator/service Stop; test never restarts automatically')
        except Exception as error:report.update(phase='FAIL',reason=str(error)[:300])
        finally:
            if started:
                if self.runner.supervisor.phase in ('RUNNING','STOPPING'):await self.runner.supervisor.stop()
                safety=await self.runner.bus.stop()
                report['safety']=safety
                if not safety.get('confirmed'):report.update(phase='FAIL',reason='mock Stop not confirmed')

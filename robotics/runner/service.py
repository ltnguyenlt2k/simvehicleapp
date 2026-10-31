"""Fixed-mode runner HTTP control. No caller-selected executable, path or bus."""
from contextlib import asynccontextmanager
import asyncio,json,os,re,uuid
from pathlib import Path
from datetime import datetime,timezone
import grpc
from fastapi import FastAPI,HTTPException
from pydantic import BaseModel,ConfigDict,Field,StrictInt
from jsonschema import Draft202012Validator
from google.protobuf.json_format import MessageToDict
from protobus.v1 import protobus_pb2 as pb,protobus_pb2_grpc as rpc
from rfrt.artifact import read_file,decode,canonical,digest,verify_application,ArtifactError
from rfrt.launch import runtime_info
from rfrt.transport import TargetBinding,BusTransport
from rfrt.values import UNKNOWN
from supervisor import Supervisor,Busy
from control_http import BodyLimit

UUID=r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
LIVE_PATHS=['Robot.Safety.Mode','Robot.Safety.IsArmed','Robot.Safety.IsStopLatched',
 'Robot.Pose.Position.X','Robot.Pose.Position.Y','Robot.Pose.Position.Z',
 'Robot.Velocity.Linear.X','Robot.PowerSystem.Battery.StateOfCharge',
 'Robot.Perception.Marker.Count','Robot.Perception.Obstacle.FrontMinDistance',
 'Robot.Simulation.TimeNs','Robot.Simulation.IsPaused']
ENV={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/tmp','LANG':'C.UTF-8',
     'PYTHONUNBUFFERED':'1','PYTHONDONTWRITEBYTECODE':'1'}

class StartInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    deploymentId:str=Field(pattern=UUID)
    requestId:str=Field(pattern=UUID)
    maxRunMs:StrictInt|None=Field(default=None,ge=1,le=3600000)

class VerifyInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    artifactHash:str=Field(pattern=r'^sha256:[a-f0-9]{64}$')

class EventInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    id:str=Field(min_length=1,max_length=128)
    name:str=Field(min_length=1,max_length=64)


class RobotBus:
    def __init__(self,mode):
        if mode not in ('sim','live'):raise ValueError('explicit runner mode required')
        self.mode=mode;self.address='protobus-'+mode+':55600'
        self.expected=pb.KINEMATIC_MOCK if mode=='sim' else pb.ROS_SIM

    async def target(self):
        async with grpc.aio.insecure_channel(self.address) as channel:
            d=await rpc.BusStub(channel).Describe(pb.Empty(),timeout=1)
        if (not d.provider_online or not d.audit_ok or d.backend!='SIM'
                or d.protocol_version!='1.6' or d.target_context.kind!=self.expected):
            raise ValueError('the commissioned simulation provider is not ready')
        return TargetBinding.record(d).record_json()

    async def stop(self):
        # Stop is never gated on a lease, advancing clock or provider readiness.
        result=dict(operatorRequested=True,requested=False,dispatched=False,confirmed=False)
        end=asyncio.get_running_loop().time()+1.5
        try:
            async with grpc.aio.insecure_channel(self.address,options=[('grpc.use_local_subchannel_pool',1)]) as channel:
                bus=rpc.BusStub(channel)
                reply=await bus.Stop(pb.StopRequest(reason='Robot Studio independent operator/process Stop'),timeout=.5)
                result.update(requested=reply.requested,dispatched=reply.dispatched,confirmed=reply.robot_confirmed,
                              executionId=reply.execution_id)
                if result['confirmed'] or not reply.execution_id:return result
                descriptor=await bus.Describe(pb.Empty(),timeout=.3)
                while asyncio.get_running_loop().time()<end:
                    state=await bus.InspectExecution(pb.ExecutionQuery(catalog_hash=descriptor.catalog_hash,
                        broker_epoch=reply.broker_epoch,execution_id=reply.execution_id),timeout=.3)
                    if (state.execution_id==reply.execution_id and state.provider_session==reply.provider_session
                            and state.broker_epoch==reply.broker_epoch and state.path=='Robot.Safety.Stop'
                            and state.physical_released and state.physical_phase==pb.SUCCEEDED):
                        result['confirmed']=True;break
                    await asyncio.sleep(.02)
        except Exception:result['reason']='Stop has not been physically confirmed'
        return result

    async def validate(self,catalog,binding):
        transport=BusTransport(self.address,catalog,binding)
        try:await transport.open()
        finally:await transport.close()

    async def live(self,catalog):
        try:
            binding=TargetBinding.from_json(await self.target())
            transport=BusTransport(self.address,catalog,binding)
            try:
                await transport.open();values=await transport.fetch([path for path in LIVE_PATHS if path in catalog['nodes']])
                samples={path:{'value':None if value is UNKNOWN else value,'quality':'UNKNOWN' if value is UNKNOWN else 'OK'} for path,value in values.items()}
                return dict(online=True,mode=self.mode,target=binding.record_json(),samples=samples)
            finally:await transport.close()
        except Exception:return dict(online=False,mode=self.mode,samples={},reason='simulation telemetry is unavailable')


class Runner:
    def __init__(self,mode,root='/projects',bus=None):
        self.mode=mode;self.root=Path(root);self.bus=bus or RobotBus(mode)
        self.supervisor=Supervisor(self.bus.stop)
        self.job=None;self.seen={};self.guard=asyncio.Lock()
        self.validator=Draft202012Validator(decode((Path(__file__).parent/'contracts/studio/deployment.v1.json').read_bytes()))
        self.catalog=decode(Path('/contracts/fixtures/rss-go2-catalog.v1.json').read_bytes())

    def deployment(self,identity):
        if re.fullmatch(UUID,identity) is None:raise ValueError('invalid deployment identity')
        record=decode(read_file(self.root,'deployments/'+identity+'/record.json'))
        self.validator.validate(record)
        if record['id']!=identity or record['mode']!=self.mode:raise ValueError('deployment mode/identity differs')
        target=decode(read_file(self.root,'deployments/'+identity+'/target.json'))
        if digest(canonical(target))!=record['targetHash']:raise ValueError('immutable deployment target was modified')
        binding=TargetBinding.from_json(target)
        expected=pb.KINEMATIC_MOCK if self.mode=='sim' else pb.ROS_SIM
        if pb.TargetContext.FromString(binding.context_bytes).kind!=expected:raise ValueError('unsupported runner target kind')
        info=runtime_info()
        if info['packageHash']!=record['runtimePackageHash']:raise ValueError('deployed runtime version differs from runner')
        folder=self.root/'artifacts'/record['artifactHash'].split(':')[1]
        app=verify_application(folder,info['packageHash']);lock=app.json('rflow.lock.json')
        if app.artifact_hash!=record['artifactHash']:raise ValueError('immutable artifact identity differs')
        if any(lock.get(key)!=value for key,value in record['identities'].items()):raise ValueError('deployed compiler/source identities differ')
        if binding.catalog_hash!=lock['catalogHash'] or binding.profile_id!=lock['profileId']:raise ValueError('target catalog/profile differs')
        return record,binding,app,folder

    def status(self):
        return dict(mode=self.mode,job=None if self.job is None else {**self.job,**self.supervisor.snapshot()})

    async def start(self,value):
        async with self.guard:
            if value.requestId in self.seen:
                prior=self.seen[value.requestId]
                if prior['deploymentId']!=value.deploymentId:raise ValueError('request identity already belongs to another deployment')
                return {**prior,'replayed':True}
            if self.supervisor.phase in ('RUNNING','STOPPING'):raise Busy('another run already owns this robot')
            if len(self.seen)>=256:raise ValueError('runner request budget exhausted; inspect state before service restart')
            record,binding,app,folder=self.deployment(value.deploymentId)
            await self.bus.validate(app.json('rss-catalog.json'),binding)
            limit=app.json('profile.json')['limits']['maxRunMs']
            if value.maxRunMs is not None:
                if value.maxRunMs>limit:raise ValueError('run duration exceeds compiled profile')
                limit=value.maxRunMs
            job=dict(id=str(uuid.uuid4()),deploymentId=value.deploymentId,requestId=value.requestId,
                     createdAt=datetime.now(timezone.utc).isoformat(),artifactHash=record['artifactHash'])
            command=['/usr/local/bin/python','-I','-m','rfrt','--root',str(folder),
                '--target',str(self.root/'deployments'/value.deploymentId/'target.json'),
                '--bus',self.bus.address,'--max-run-ms',str(limit),'--events-stdin']
            await self.supervisor.start(command,ENV)
            self.job=job;self.seen[value.requestId]=dict(job)
            return self.status()['job']


def create_app(mode=None,root='/projects',bus=None):
    mode=mode or os.environ.get('SR_RUNNER_MODE','sim')
    if mode not in ('sim','live'):raise ValueError('invalid fixed runner mode')
    runner=Runner(mode,root,bus)
    from scenarios import ScenarioTests
    tests=ScenarioTests(runner)
    @asynccontextmanager
    async def lifespan(app):
        yield
        await tests.cancel()
        if runner.supervisor.phase in ('RUNNING','STOPPING'):await runner.supervisor.stop()
    app=FastAPI(title='Robot Studio fixed-mode runner',version='0.1.0',lifespan=lifespan)
    app.add_middleware(BodyLimit,maximum=131072)
    app.state.runner=runner

    @app.exception_handler(Busy)
    async def busy(request,error):
        from fastapi.responses import JSONResponse
        return JSONResponse({'error':'another run already owns this robot'},status_code=409)

    @app.get('/health')
    def health():return {'ready':True,'mode':mode}

    @app.get('/capabilities')
    def capabilities():return {'schema':'runner-capabilities.v1','mode':mode,'runtime':runtime_info(),'hardwareSupported':False}

    @app.get('/target')
    async def target():
        try:return await runner.bus.target()
        except Exception:raise HTTPException(503,'simulation provider is not ready')

    @app.get('/live')
    async def live():return await runner.bus.live(runner.catalog)

    @app.get('/status')
    def status():return runner.status()

    @app.get('/logs')
    def logs(after:int=0):
        if after<0:raise HTTPException(422,'invalid log cursor')
        entries=[];size=0
        for item in runner.supervisor.entries(after):
            length=len(item['text'].encode())
            if entries and (len(entries)>=64 or size+length>131072):break
            entries.append(item);size+=length
        first=runner.supervisor.entries()
        return dict(jobId=runner.job['id'] if runner.job else None,entries=entries,
                    gap=bool(first and after<first[0]['seq']-1),latest=runner.supervisor.sequence)

    @app.post('/verify')
    def verify(value:VerifyInput):
        try:
            folder=runner.root/'artifacts'/value.artifactHash.split(':')[1]
            checked=verify_application(folder,runtime_info()['packageHash'])
            if checked.artifact_hash!=value.artifactHash:raise ValueError('artifact identity differs')
            return {'verified':True,'artifactHash':checked.artifact_hash,'files':len(checked.files)}
        except Exception:raise HTTPException(409,'artifact or installed runtime integrity check failed')

    @app.post('/start')
    async def start(value:StartInput):
        if tests.active:raise Busy('a scenario test owns this robot')
        try:return await runner.start(value)
        except Busy:raise
        except Exception:raise HTTPException(409,'deployment, target, runtime or source changed; inspect and deploy explicitly again')

    @app.post('/stop')
    async def stop():
        await tests.cancel()
        active=runner.supervisor.phase in ('RUNNING','STOPPING')
        process=await runner.supervisor.stop()
        safety=process.get('safeResult') if active else await runner.bus.stop()
        return {'process':process,'safety':safety}

    @app.post('/event')
    async def event(value:EventInput):
        if tests.active:raise HTTPException(409,'the scenario controls events during this test')
        try:await runner.supervisor.event(json.dumps({'schema':'rfevent.v1','id':value.id,'name':value.name}));return {'accepted':True}
        except Exception:raise HTTPException(409,'run is not accepting that event')

    if mode=='sim':
        @app.post('/tests/{deployment_id}')
        async def run_test(deployment_id:str,scenario:dict):
            try:return tests.launch(deployment_id,scenario)
            except Busy:raise
            except Exception:raise HTTPException(422,'scenario/deployment does not satisfy the closed mock test contract')
        @app.get('/tests')
        def test_report():return {'report':tests.report}
    return app

"""Studio projects, immutable build/deploy and explicit run control boundary."""
from contextlib import asynccontextmanager
import asyncio,io,json,os,threading,uuid,zipfile
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse
from fastapi import FastAPI,HTTPException,WebSocket,WebSocketDisconnect
from fastapi.responses import JSONResponse,Response
from pydantic import BaseModel,ConfigDict,Field,StrictBool,StrictInt
from store import Store,Conflict,Missing,identity,FILES,canonical,digest
from services import Services
from http_guard import BodyLimit,RequestGuard

UUID=r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
Mode=Literal['sim','live']
class Closed(BaseModel):model_config=ConfigDict(extra='forbid')
class CreateInput(Closed):
    name:str=Field(min_length=1,max_length=96)
    template:str=Field(default='blank',max_length=64)
class SaveInput(Closed):
    revision:StrictInt=Field(ge=1)
    name:str=Field(min_length=1,max_length=96)
    workflow:dict
class LintInput(Closed):
    workflow:dict
    authorizeSimArm:StrictBool=False
class BuildInput(Closed):
    revision:StrictInt=Field(ge=1)
    authorizeSimArm:StrictBool=False
    mode:Mode='sim'
class DeployInput(Closed):
    buildId:str=Field(pattern=UUID)
    mode:Mode
class StartInput(Closed):
    requestId:str=Field(pattern=UUID)
    maxRunMs:StrictInt|None=Field(default=None,ge=1,le=3600000)
class EventInput(Closed):
    deploymentId:str|None=Field(default=None,pattern=UUID)
    id:str=Field(min_length=1,max_length=128)
    name:str=Field(min_length=1,max_length=64)


def create_app(root=None,services=None,zoo_key=None,origins=None):
    store=Store(root or os.environ.get('SR_PROJECT_ROOT','/projects'))
    owned=services is None
    build_slots=asyncio.Semaphore(2)
    export_slot=threading.Semaphore(1)
    if zoo_key is None:
        key=Path('/control/zoo-key')
        if key.is_file():zoo_key=key.read_text().strip()
    if zoo_key is not None and len(zoo_key)<32:raise ValueError('bounded Zoo service capability required')
    @asynccontextmanager
    async def lifespan(app):
        if owned:app.state.services=Services()
        yield
        if owned:await app.state.services.close()
    app=FastAPI(title='Robot Studio',version='0.1.0',lifespan=lifespan)
    app.state.store=store;app.state.services=services
    app.add_middleware(BodyLimit)
    app.add_middleware(RequestGuard,origins=origins or ['http://localhost:3180','http://127.0.0.1:3180'],zoo_key=zoo_key)
    def remote():return app.state.services

    @app.exception_handler(Conflict)
    async def conflict(request,error):return JSONResponse({'error':str(error),'code':'STATE_CONFLICT'},status_code=409)
    @app.exception_handler(Missing)
    async def missing(request,error):return JSONResponse({'error':'Không tìm thấy project hoặc bản deploy.'},status_code=404)
    @app.exception_handler(ValueError)
    async def invalid(request,error):return JSONResponse({'error':str(error)},status_code=422)

    @app.get('/config')
    def configuration():
        base=os.environ.get('SR_ROBOT_ZOO_URL','http://127.0.0.1:8092').rstrip('/')
        parsed=urlparse(base)
        if (parsed.scheme!='http' or parsed.hostname not in ('localhost','127.0.0.1')
                or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
            raise HTTPException(503,'Địa chỉ Robot Zoo cục bộ chưa hợp lệ.')
        return {'zooBaseUrl':base,'hardwareSupported':False,'version':'0.1.0'}

    @app.get('/health')
    def health():return {'ready':True,'version':'0.1.0','hardwareSupported':False}
    @app.get('/blocks')
    async def blocks():return await remote().compiler('GET','/blocks')
    @app.get('/rss/catalog')
    async def catalog():return await remote().compiler('GET','/rss/catalog')
    @app.get('/templates')
    async def templates():return await remote().compiler('GET','/templates')
    @app.get('/capabilities/{mode}')
    async def capabilities(mode:Mode):return await remote().runner(mode,'GET','/capabilities')
    @app.get('/projects')
    def projects():return {'projects':store.list()}
    @app.post('/projects')
    async def create(value:CreateInput):
        if value.template=='blank':
            catalog=await remote().compiler('GET','/rss/catalog')
            workflow={'schema':'robotflow.v1','rss':{'version':'0.1','catalogHash':catalog['catalogHash']},
                'profile':'dog-go2-sim','vars':{},'nodes':[{'id':'start','block':'rf.on_start','v':1,'props':{},'ui':{'x':80,'y':80}}],'edges':[]}
        else:
            available=(await remote().compiler('GET','/templates'))['templates']
            if value.template not in available:raise HTTPException(422,'Không tìm thấy workflow mẫu.')
            workflow=available[value.template]
        return store.create(value.name,workflow)
    @app.get('/projects/{project_id}')
    def project(project_id:str):return store.get(project_id)
    @app.put('/projects/{project_id}')
    def save(project_id:str,value:SaveInput):return store.save(project_id,value.revision,value.name,value.workflow)
    @app.post('/lint')
    async def lint(value:LintInput):return await remote().compiler('POST','/lint',value.model_dump())
    @app.post('/projects/{project_id}/build')
    async def build(project_id:str,value:BuildInput):
        async with build_slots:
            project=store.get(project_id)
            if project['revision']!=value.revision:raise Conflict('Project đã thay đổi; lưu rồi build lại.')
            capability=await remote().runner(value.mode,'GET','/capabilities')
            pin=capability['runtime']['packageHash']
            result=await remote().compiler('POST','/build',dict(workflow=project['workflow'],authorizeSimArm=value.authorizeSimArm,runtimePackageHash=pin))
            if not result['ok']:return {'ok':False,'diagnostics':result['diagnostics']}
            record=store.publish_build(project_id,value.revision,result['files'],pin)
            verified=await remote().runner(value.mode,'POST','/verify',{'artifactHash':record['artifactHash']})
            if not verified.get('verified'):raise HTTPException(502,'Bản build chưa qua xác minh runtime.')
            return {'ok':True,'diagnostics':result['diagnostics'],'build':{k:v for k,v in record.items() if k!='projectSnapshot'}}
    @app.post('/deployments')
    async def deploy(value:DeployInput):
        build=store.build(value.buildId)
        capability=await remote().runner(value.mode,'GET','/capabilities')
        if capability['runtime']['packageHash']!=build['runtimePackageHash']:raise Conflict('Runtime đã thay đổi; build lại trước khi deploy.')
        target=await remote().runner(value.mode,'GET','/target')
        return store.deploy(value.buildId,value.mode,target)
    @app.get('/projects/{project_id}/deployments')
    def deployments(project_id:str):return {'deployments':store.deployments(project_id)}
    @app.get('/deployments/{deployment_id}')
    def deployment(deployment_id:str):return store.deployment(deployment_id)
    @app.get('/deployments/{deployment_id}/source')
    def source(deployment_id:str):
        record=store.deployment(deployment_id);build=store.build(record['buildId'])
        return {'workflow':build['projectSnapshot']['workflow'],'name':build['projectSnapshot']['name'],'revision':build['projectRevision'],'artifactHash':record['artifactHash']}

    @app.get('/deployments/{deployment_id}/zoo-link')
    def zoo_link(deployment_id:str):
        record=store.deployment(deployment_id)
        if record['mode']!='live':raise HTTPException(409,'Bản deploy này thuộc mô phỏng nhẹ, chưa phải Robot Zoo.')
        return {'url':configuration()['zooBaseUrl']+'/?deployment='+identity(deployment_id)}

    @app.post('/deployments/{deployment_id}/start')
    async def start(deployment_id:str,value:StartInput):
        record=store.deployment(deployment_id)
        store.reserve_start(value.requestId,deployment_id)
        return await remote().runner(record['mode'],'POST','/start',{'deploymentId':deployment_id,**value.model_dump(exclude_none=True)})
    @app.post('/control/{mode}/stop')
    async def stop(mode:Mode):return await remote().runner(mode,'POST','/stop')
    @app.post('/control/{mode}/event')
    async def event(mode:Mode,value:EventInput):return await remote().runner(mode,'POST','/event',value.model_dump(exclude_none=True))
    @app.post('/deployments/{deployment_id}/test')
    async def test_start(deployment_id:str,scenario:dict):
        record=store.deployment(deployment_id)
        if record['mode']!='sim':raise HTTPException(409,'Scenario chỉ chạy trên Mock, không có trên ROS.')
        return await remote().runner('sim','POST','/tests/'+deployment_id,scenario)
    @app.get('/tests')
    async def test_report():return await remote().runner('sim','GET','/tests')
    @app.get('/snapshot/{mode}')
    async def snapshot(mode:Mode,after:int=0):
        if after<0:raise HTTPException(422,'Con trỏ log không hợp lệ.')
        status,live,logs=await asyncio.gather(remote().runner(mode,'GET','/status'),
            remote().runner(mode,'GET','/live'),remote().runner(mode,'GET','/logs?after='+str(after)))
        return {'status':status,'live':live,'logs':logs}
    @app.websocket('/ws/{mode}')
    async def websocket(websocket:WebSocket,mode:Mode):
        await websocket.accept();cursor=0;job=None
        try:
            while True:
                try:
                    frame=await snapshot(mode,cursor)
                    current=frame['logs'].get('jobId')
                    if current!=job:
                        cursor=0;job=current
                        frame=await snapshot(mode,cursor)
                    entries=frame['logs']['entries']
                    if entries:cursor=entries[-1]['seq']
                    await websocket.send_json(frame)
                except HTTPException:await websocket.send_json({'unavailable':True,'mode':mode})
                await asyncio.sleep(.4)
        except (WebSocketDisconnect,RuntimeError):return
    @app.get('/deployments/{deployment_id}/export')
    def export(deployment_id:str):
        with export_slot:
            deployment=store.deployment(deployment_id);build=store.build(deployment['buildId'])
            folder=store.root/'artifacts'/deployment['artifactHash'].split(':')[1]
            files={name:store._read_bytes(folder/name,4*1024*1024).decode('utf-8') for name in FILES}
            store.check_files(files,build['runtimePackageHash'])
            target=store._read_bytes(store.root/'deployments'/deployment_id/'target.json',65536)
            if digest(canonical(json.loads(target)))!=deployment['targetHash']:raise ValueError('immutable target was modified')
            buffer=io.BytesIO()
            with zipfile.ZipFile(buffer,'w',compression=zipfile.ZIP_DEFLATED) as archive:
                for name in sorted(FILES):archive.writestr(name,files[name])
                archive.writestr('deployment.json',json.dumps(deployment,ensure_ascii=False,indent=2))
                archive.writestr('project.json',json.dumps(build['projectSnapshot'],ensure_ascii=False,indent=2))
                archive.writestr('target.json',target)
            return Response(buffer.getvalue(),media_type='application/zip',headers={'Content-Disposition':'attachment; filename="robot-workflow-'+deployment_id+'.zip"'})
    def zoo_record(deployment_id):
        record=store.deployment(deployment_id)
        if record['mode']!='live':raise HTTPException(409,'Robot Zoo chỉ chạy bản deploy ROS simulation.')
        return record
    @app.get('/zoo/deployments/{deployment_id}')
    async def zoo_status(deployment_id:str,after:int=0):
        record=zoo_record(deployment_id)
        return {'deployment':record,**(await snapshot('live',after))}
    @app.post('/zoo/deployments/{deployment_id}/start')
    async def zoo_start(deployment_id:str,value:StartInput):
        zoo_record(deployment_id)
        return await start(deployment_id,value)
    @app.post('/zoo/deployments/{deployment_id}/stop')
    async def zoo_stop(deployment_id:str):
        zoo_record(deployment_id)
        return await stop('live')
    @app.post('/zoo/deployments/{deployment_id}/event')
    async def zoo_event(deployment_id:str,value:EventInput):
        zoo_record(deployment_id)
        return await event('live',EventInput(**{**value.model_dump(),'deploymentId':deployment_id}))
    return app

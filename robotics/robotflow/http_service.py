"""Pure, bounded HTTP compiler. No generated code execution or project writes."""
import asyncio,json
from pathlib import Path
from typing import Annotated
from fastapi import FastAPI,Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel,ConfigDict,Field,StrictBool
from compiler import compile_workflow,strict_pairs,canonical
from codegen import build_application,VERSION
from registry import load_registry
from templates import templates

MAX_BODY=2*1024*1024

class BodyLimit:
    def __init__(self,app):self.app=app
    async def __call__(self,scope,receive,send):
        if scope['type']!='http':return await self.app(scope,receive,send)
        chunks=[];total=0;deadline=asyncio.get_running_loop().time()+5
        while True:
            remaining=deadline-asyncio.get_running_loop().time()
            try:
                if remaining<=0:raise asyncio.TimeoutError()
                message=await asyncio.wait_for(receive(),remaining)
            except asyncio.TimeoutError:
                return await JSONResponse({'error':'compiler request timed out'},status_code=408)(scope,receive,send)
            if message['type']=='http.disconnect':return
            if message['type']!='http.request':continue
            content=message.get('body',b'');total+=len(content)
            if total>MAX_BODY:
                return await JSONResponse({'error':'request exceeds compiler budget'},status_code=413)(scope,receive,send)
            chunks.append(content)
            if not message.get('more_body',False):break
        raw=b''.join(chunks);chunks.clear()
        if raw:
            try:
                parsed=json.loads(raw,object_pairs_hook=strict_pairs)
                if not isinstance(parsed,dict):raise ValueError('JSON object required')
                canonical(parsed)
            except (ValueError,UnicodeError,RecursionError):
                return await JSONResponse({'error':'strict JSON object required'},status_code=422)(scope,receive,send)
        replayed=False
        async def replay():
            nonlocal replayed
            if replayed:return await receive()
            replayed=True
            return {'type':'http.request','body':raw,'more_body':False}
        return await self.app(scope,replay,send)

class LintInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    workflow:dict
    authorizeSimArm:StrictBool=False

class BuildInput(LintInput):
    runtimePackageHash:Annotated[str,Field(pattern=r'^sha256:[a-f0-9]{64}$')]

api=FastAPI(title='RobotFlow pure compiler',version=VERSION)
api.add_middleware(BodyLimit)
slots=asyncio.Semaphore(2)
catalog=json.loads(Path('/contracts/fixtures/rss-go2-catalog.v1.json').read_text())
registry=load_registry()

@api.exception_handler(RequestValidationError)
async def invalid_input(request:Request,error:RequestValidationError):
    return JSONResponse({'error':'invalid compiler request','fields':[
        {'location':list(item['loc']),'type':item['type']} for item in error.errors()[:20]]},status_code=422)

def profile(authorized):
    value=json.loads((Path(__file__).parent/'profiles/dog-go2-sim.json').read_text())
    value['allowRemoteArm']=authorized
    return value

@api.get('/health')
def health():return {'ready':True,'compilerVersion':VERSION,'catalogHash':catalog['catalogHash']}

@api.get('/blocks')
def blocks():return registry.public()

@api.get('/rss/catalog')
def rss_catalog():return catalog

@api.get('/templates')
def workflow_templates():return {'schema':'robotflow-templates.v1','templates':templates()}

@api.post('/lint')
async def lint(value:LintInput):
    async with slots:
        return await asyncio.to_thread(compile_workflow,value.workflow,catalog,
                                       profile(value.authorizeSimArm),registry,'lint')

@api.post('/build')
async def build(value:BuildInput):
    async with slots:
        return await asyncio.to_thread(build_application,value.workflow,catalog,
            profile(value.authorizeSimArm),registry,None,value.runtimePackageHash)

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

from control_http import BodyLimit,MAX_BODY

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

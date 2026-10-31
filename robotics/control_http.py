"""Shared ASGI strict JSON and bounded body transport; no project/runtime state."""
import asyncio,json
from fastapi.responses import JSONResponse
MAX_BODY=2*1024*1024

def strict_pairs(pairs):
    value={}
    for key,item in pairs:
        if key in value:raise ValueError('duplicate JSON key')
        value[key]=item
    return value

def canonical(value):return json.dumps(value,allow_nan=False).encode()

class BodyLimit:
    def __init__(self,app,maximum=MAX_BODY):self.app=app;self.maximum=maximum
    async def __call__(self,scope,receive,send):
        if scope['type']!='http':return await self.app(scope,receive,send)
        chunks=[];total=0;deadline=asyncio.get_running_loop().time()+5
        while True:
            remaining=deadline-asyncio.get_running_loop().time()
            try:
                if remaining<=0:raise asyncio.TimeoutError()
                message=await asyncio.wait_for(receive(),remaining)
            except asyncio.TimeoutError:
                return await JSONResponse({'error':'request timed out'},status_code=408)(scope,receive,send)
            if message['type']=='http.disconnect':return
            if message['type']!='http.request':continue
            content=message.get('body',b'');total+=len(content)
            if total>self.maximum:
                return await JSONResponse({'error':'request exceeds request budget'},status_code=413)(scope,receive,send)
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

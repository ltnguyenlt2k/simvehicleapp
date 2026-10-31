"""Local UI origin and fixed Zoo service capability, before request parsing."""
import hmac
from fastapi.responses import JSONResponse
from control_http import BodyLimit

class RequestGuard:
    def __init__(self,app,origins,zoo_key=None):self.app=app;self.origins=set(origins);self.zoo_key=zoo_key
    async def __call__(self,scope,receive,send):
        if scope['type'] not in ('http','websocket'):return await self.app(scope,receive,send)
        headers={key.decode().lower():value.decode('latin-1') for key,value in scope.get('headers',[])}
        zoo=scope.get('path','').startswith('/zoo/')
        if zoo:
            supplied=headers.get('x-zoo-capability','')
            allowed=bool(self.zoo_key and hmac.compare_digest(supplied,self.zoo_key))
        else:allowed=headers.get('origin') in self.origins
        writes=scope['type']=='websocket' or scope.get('method') in ('POST','PUT','PATCH','DELETE')
        if (zoo or writes) and not allowed:
            if scope['type']=='websocket':return await send({'type':'websocket.close','code':1008})
            return await JSONResponse({'error':'local operator origin or Zoo capability required'},status_code=403)(scope,receive,send)
        return await self.app(scope,receive,send)

"""Fixed service destinations. No browser-provided URL, broker or executable."""
import json
import httpx
from fastapi import HTTPException

class Services:
    def __init__(self):
        self.client=httpx.AsyncClient(timeout=httpx.Timeout(10,connect=2),limits=httpx.Limits(max_connections=16,max_keepalive_connections=8))
    async def close(self):await self.client.aclose()
    async def request(self,url,method,path,data=None):
        try:
            async with self.client.stream(method,url+path,json=data) as response:
                if response.status_code>=400:
                    if response.status_code==422:raise HTTPException(422,'Dữ liệu chưa hợp lệ. Kiểm tra cấu trúc, tên lệnh, kiểu giá trị và giới hạn kịch bản.')
                    if response.status_code==409:raise HTTPException(409,'Một phiên khác đang chạy hoặc đích đã thay đổi. Kiểm tra trạng thái trước khi chạy lại.')
                    raise HTTPException(503,'Dịch vụ mô phỏng chưa sẵn sàng. Không có lệnh chạy lại tự động.')
                chunks=[];size=0
                async for chunk in response.aiter_bytes():
                    size+=len(chunk)
                    if size>32*1024*1024:raise HTTPException(502,'Dữ liệu dịch vụ vượt giới hạn.')
                    chunks.append(chunk)
                return json.loads(b''.join(chunks))
        except httpx.HTTPError:raise HTTPException(503,'Chưa kết nối được dịch vụ mô phỏng. Hãy kiểm tra trạng thái.')
    async def compiler(self,method,path,data=None):return await self.request('http://rflowc:8012',method,path,data)
    async def runner(self,mode,method,path,data=None):
        if mode not in ('sim','live'):raise HTTPException(422,'Chế độ không được hỗ trợ.')
        return await self.request('http://runner-'+mode+':8011',method,path,data)

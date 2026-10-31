"""Fault-only wrapper: verified native app plus explicit allocation injection.
Not an application artifact, compiler feature or remotely selectable command.
"""
import asyncio,sys
from rfrt.launch import execute

async def main():
    async def pressure():
        line=await asyncio.get_running_loop().run_in_executor(None,sys.stdin.readline)
        if line.strip()!='ALLOCATE':return
        blocks=[]
        while True:blocks.append(bytearray(4*1024*1024))
    allocation=asyncio.create_task(pressure())
    try:return await execute('/apps/hold','/tmp/target.json','protobus-sim:55600',30000,False)
    finally:allocation.cancel()

raise SystemExit(asyncio.run(main()))

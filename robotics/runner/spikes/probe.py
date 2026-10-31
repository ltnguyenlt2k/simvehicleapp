"""Actual SDK child, independent mock state, OOM and network qualification.
Synthetic kinematic provider only. No ROS, hardware or physical equivalence claim.
"""
import asyncio,base64,json,os,socket,sys,time
from pathlib import Path
from google.protobuf import descriptor_pool,message_factory
import grpc
from protobus.v1 import protobus_pb2 as pb,protobus_pb2_grpc as rpc
from rfrt.transport import TargetBinding,BusTransport
from rfrt.bus import BusClient
from rfrt.launch import load_application,runtime_info
from supervisor import Supervisor,Busy

ENV={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/tmp','LANG':'C.UTF-8','PYTHONUNBUFFERED':'1'}

def oom_count():
    rows=dict(line.split() for line in Path('/sys/fs/cgroup/memory.events').read_text().splitlines())
    return int(rows['oom_kill'])

def denied(host,port):
    try:
        with socket.create_connection((host,port),timeout=.5):return False
    except OSError:return True

async def main():
    assert os.getuid()!=0
    app,lock,_=load_application('/apps/hold');catalog=app.json('rss-catalog.json')
    try:Path('/apps/hold/app/flow.py').open('a')
    except OSError:pass
    else:raise AssertionError('application mount was writable')
    assert any(line.split()[1]=='/apps' and 'ro' in line.split()[3].split(',') for line in Path('/proc/mounts').read_text().splitlines())
    assert denied('1.1.1.1',443),'unexpected external TCP route'
    assert denied('opposite',8010),'unexpected opposite-mode route'
    # Name resolves on the shared control network; binding front-only is what denies it.
    socket.gethostbyname('guard-api')
    assert denied('guard-api',8010),'control client can reach frontend API listener'
    pool=descriptor_pool.Default();pool.AddSerializedFile(base64.b64decode(Path('/apps/mock-descriptor.b64').read_text()))
    State=message_factory.GetMessageClass(pool.FindMessageTypeByName('protobus.mock.v1.StateReply'))
    bus_channel=grpc.aio.insecure_channel('protobus-sim:55600');mock_channel=grpc.aio.insecure_channel('mock:55601')
    bus=rpc.BusStub(bus_channel)
    get_state=mock_channel.unary_unary('/protobus.mock.v1.MockControl/State',request_serializer=pb.Empty.SerializeToString,response_deserializer=State.FromString)
    reset=mock_channel.unary_unary('/protobus.mock.v1.MockControl/Reset')
    async def wait(predicate,timeout=10):
        end=time.monotonic()+timeout
        while True:
            value=await predicate()
            if value:return value
            assert time.monotonic()<end,'actual SDK/mock state timeout'
            await asyncio.sleep(.02)
    async def ready():
        d=await bus.Describe(pb.Empty(),timeout=1)
        return d if d.provider_online else None
    results=[]
    try:
        for case in ('normal-stop','memory-oom'):
            before=await wait(ready)
            reset_by=time.monotonic()+4
            while True:
                try:await reset(b'',timeout=1);break
                except grpc.aio.AioRpcError as error:
                    assert error.code()==grpc.StatusCode.FAILED_PRECONDITION and time.monotonic()<reset_by
                    await asyncio.sleep(.05)
            async def replaced():
                d=await ready()
                return d if d and d.provider_session!=before.provider_session else None
            descriptor=await wait(replaced)
            binding=TargetBinding.record(descriptor)
            Path('/tmp/target.json').write_text(json.dumps(binding.record_json()))
            async def safe():
                client=BusClient(BusTransport('protobus-sim:55600',catalog,binding))
                await client.open(False)
                try:
                    outcome=await client.stop(1000)
                    return dict(confirmed=outcome.ok and outcome.physical_confirmed,phase=outcome.phase)
                finally:await client.close()
            runner=Supervisor(safe)
            command=([sys.executable,'-I','/opt/runner/spikes/memory_app.py'] if case=='memory-oom' else
                [sys.executable,'-I','-m','rfrt','--root','/apps/hold','--target','/tmp/target.json','--bus','protobus-sim:55600','--max-run-ms','30000'])
            prior_oom=oom_count()
            await runner.start(command,ENV)
            try:
                async def moving():
                    observed=await get_state(pb.Empty(),timeout=1)
                    return observed if observed.linear_x>.15 and observed.x>.01 else None
                observed=await wait(moving)
                proc_status=Path('/proc/'+str(runner.process.pid)+'/status').read_text()
                assert 'Uid:\t10001\t10001' in proc_status,proc_status
                try:await runner.start(command,ENV)
                except Busy:pass
                else:raise AssertionError('overlapping native run was admitted')
                if case=='memory-oom':
                    runner.process.stdin.write(b'ALLOCATE\n');await runner.process.stdin.drain()
                    result=await asyncio.wait_for(runner.finished,8)
                    assert result['exitCode']==-9 and oom_count()>prior_oom,result
                    assert result['phase']=='FAILED',result
                else:
                    result=await runner.stop()
                    assert result['exitCode']==0 and result['phase']=='STOPPED' and not result['forced'],result
                assert result['safeResult']['confirmed'],result
                final=await get_state(pb.Empty(),timeout=1)
                assert final.mode=='SAFE_STOP' and final.linear_x==final.angular_z==0 and not final.motion_active,final
                record=dict(case=case,passed=True,scope='actual native SDK / kinematic mock only',
                    observedMovingX=observed.x,observedMovingVelocity=observed.linear_x,
                    oomKillDelta=oom_count()-prior_oom,process=result,runtime=runtime_info())
                print(json.dumps(record),flush=True);results.append(record)
            finally:
                if runner.phase in ('RUNNING','STOPPING'):await runner.stop()
        print(json.dumps(dict(passed=True,scope='S-R6 native child prototype',uid=os.getuid(),cases=len(results),
            readOnlyArtifacts=True,outsideDenied=True,oppositeModeDenied=True,controlToFrontListenerDenied=True)),flush=True)
    finally:await bus_channel.close();await mock_channel.close()

if __name__=='__main__':asyncio.run(main())

"""Host qualification of four real native applications on the kinematic mock."""
import json
from pathlib import Path
import signal
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'runtime/t08'
CLI=['python3',str(ROOT/'scripts/native_cli.py')]
INFO=json.loads(subprocess.check_output(['docker','run','--rm','--network','none','sr-rfrt:dev','python','-I','-m','rfrt','--runtime-info'],text=True))
TAG=INFO['packageHash'].split(':')[1][:10]
COMPOSE=['docker','compose','-f',str(ROOT/'compose.yaml')]


def mock(action):
    # Test-only API exists exclusively on the mock network.
    script="""import grpc,json,time
from google.protobuf.json_format import ParseDict,MessageToDict
from protobus.mock.v1 import mock_pb2 as m,mock_pb2_grpc as rpc
from protobus.v1 import protobus_pb2 as p,protobus_pb2_grpc as prpc
with grpc.insecure_channel('protobus-mock:55601') as channel:
 c=rpc.MockControlStub(channel)
 ACTION
"""
    if action=='reset':statement="""with grpc.insecure_channel('protobus-sim:55600') as bus_channel:
  bus=prpc.BusStub(bus_channel)
  before=bus.Describe(p.Empty(),timeout=3).provider_session
  c.Reset(m.ResetRequest(),timeout=3)
  deadline=time.monotonic()+10
  while True:
   d=bus.Describe(p.Empty(),timeout=3)
   if d.provider_online and d.provider_session!=before:break
   assert time.monotonic()<deadline,'reset session not ready'
   time.sleep(.05)"""
    elif action=='state':statement="print(json.dumps(MessageToDict(c.State(p.Empty(),timeout=3))))"
    else:
        path,value=('Robot.Perception.Marker.Count',{'uint32Value':1}) if action=='RW-A' else ('Robot.PowerSystem.Battery.StateOfCharge',{'float64Value':12.})
        payload={'steps':[{'atMs':0,'sensor':{'path':path,'quality':'OK','value':value}}]}
        statement='c.Schedule(ParseDict('+repr(payload)+',m.ScenarioRequest()),timeout=3)'
    result=subprocess.run(COMPOSE+['exec','-T','protobus-mock','python','-c',script.replace('ACTION',statement)],capture_output=True,text=True,timeout=10)
    assert result.returncode==0,result.stderr
    return json.loads(result.stdout) if action=='state' else None


def run(case):
    app='t08-'+case.lower().replace('-','')+'-'+TAG
    if not (ROOT/'runtime/apps'/app).exists():
        subprocess.run(CLI+['build',str(OUTPUT/'flows'/(case+'.json')),'--out',app,'--authorize-sim-arm'],check=True,timeout=30)
    mock('reset')
    # Mock stable bindings intentionally survive explicit idle reset; no ROS binding refresh.
    process=subprocess.Popen(CLI+['run','--sim',app,'--target','t08-mock','--events-stdin','--max-run-ms','120000'],
        stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    events=[];injected=False;completed=False
    try:
        with (OUTPUT/('native-'+case+'-mock.log')).open('w') as log:
            for line in process.stdout:
                log.write(line);log.flush()
                if not line.startswith('RFTRACE '):continue
                event=json.loads(line[8:]);events.append(event)
                if event['event']=='bus_bound' and not injected:
                    if case in ('RW-A','RW-D'):mock(case)
                    elif case=='RW-C':
                        import time
                        time.sleep(.1)
                        message=json.dumps({'schema':'rfevent.v1','id':'native-jump','name':'jump'})+'\n'
                        process.stdin.write(message);process.stdin.flush()
                    injected=True
                if event['event']=='log' and event['nodeId']==('low_log' if case=='RW-D' else 'complete_log'):
                    completed=True
                    if case!='RW-D':process.send_signal(signal.SIGTERM)
            code=process.wait(timeout=10)
        errors=process.stderr.read()
        assert code==0,(case,code,errors)
        assert completed,(case,'missing success path')
        starts=[e['nodeId'] for e in events if e['event']=='node_started']
        assert not any(name.startswith('failure_') or name.startswith('patrol_failure_') for name in starts),starts
        assert any(e['event']=='safety_stop_result' and e['data']['physicalConfirmed'] for e in events)
        expected={'RW-A':['lift','bow','complete_disarm'],'RW-B':['patrol','complete_disarm'],
                  'RW-C':['jump','complete_disarm'],'RW-D':['cancel','crouch','low_disarm','low_stop']}[case]
        assert all(name in starts for name in expected),(case,starts)
        if case=='RW-B':
            goals=[e for e in events if e['event']=='node_finished' and e['nodeId']=='patrol' and e['data']['phase']=='SUCCEEDED']
            assert len(goals)==6,len(goals)
        if case=='RW-D':
            header=next(e for e in events if e['event']=='run_started')
            triggered=next(e for e in events if e['event']=='behavior_started' and e['nodeId']=='battery_low')
            assert int(triggered['monotonicNs'])-int(header['monotonicNs'])>=5_000_000_000
        state=mock('state')
        assert state['mode']=='SAFE_STOP' and not state.get('motionActive',False)
        assert state.get('linearX',0)==state.get('angularZ',0)==0
        result={'passed':True,'case':case,'scope':'actual native application / kinematic mock only',
                'runId':events[0]['runId'],'nodeStarts':len(starts),'safeState':state}
        print(json.dumps(result),flush=True)
        return result
    finally:
        if process.poll() is None:
            process.send_signal(signal.SIGTERM);process.wait(timeout=15)

if __name__=='__main__':
    results=[run(case) for case in (sys.argv[1:] or ['RW-A','RW-B','RW-C','RW-D'])]
    (OUTPUT/'native-templates-mock.json').write_text(json.dumps(results,indent=2)+'\n')

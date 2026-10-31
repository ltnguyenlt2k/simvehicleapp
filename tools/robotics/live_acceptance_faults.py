"""Explicit physical Hold / Stop / restart checks. Never used by Studio product routes."""
import concurrent.futures,fcntl,json,subprocess,time,urllib.request,urllib.error,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]/'robotics';OUT=ROOT/'runtime/m27';OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:3180';DOG='http://127.0.0.1:8092';results=[]
def http(path,body=None,base=BASE):
    request=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json','Origin':base})
    with urllib.request.urlopen(request,timeout=15) as response:return json.load(response)
def wait(predicate,seconds=15):
    end=time.monotonic()+seconds;last=None
    while time.monotonic()<end:
        try:
            last=predicate()
            if last:return last
        except (urllib.error.URLError,KeyError):pass
        time.sleep(.05)
    raise AssertionError('bounded wait did not pass: '+str(last))
def snapshot():return http('/api/snapshot/live')
def stopped():
    state=http('/api/state',base=DOG)
    return state if state['brain']['mode']=='SAFE_STOP' and state['brain']['authority']['owner'] is None and max(abs(v) for v in state['sim']['velocity'])<.05 else None
def target_ready():return snapshot()['live']['online']
def record(name,data):
    results.append({'case':name,'passed':True,**data});(OUT/'live-restart-faults.json').write_text(json.dumps({'passed':False,'results':results},indent=2))

def main():
    code="""import json
from templates import Graph
from registry import load_registry
g=Graph(load_registry());start=g.add('start','on_start');fail=g.cleanup('failure');move=g.add('hold','move',{'linear':'0.15 m/s','angular':'0 rad/s','durationMs':10000,'timeoutMs':12000});done=g.complete('complete',fail,'bounded Hold completed');g.setup(start,move,fail);g.results(move,done,fail);print(json.dumps(g.value()))"""
    workflow=json.loads(subprocess.check_output(['docker','run','--rm','--network','none','sr-robotflow:dev','python','-c',code],text=True))
    project=http('/api/projects',{'name':'M27 physical Hold restart faults','template':'blank'})
    # PUT is explicit editor-source fixture setup, not a shortcut in the recorded UI journey.
    request=urllib.request.Request(BASE+'/api/projects/'+project['id'],data=json.dumps({'revision':project['revision'],'name':project['name'],'workflow':workflow}).encode(),method='PUT',headers={'Content-Type':'application/json','Origin':BASE})
    project=json.load(urllib.request.urlopen(request,timeout=15))
    built=http('/api/projects/'+project['id']+'/build',{'revision':project['revision'],'authorizeSimArm':True,'mode':'live'});assert built['ok'],built
    deployment=http('/api/deployments',{'buildId':built['build']['id'],'mode':'live'})
    def begin():
        wait(target_ready);identity=str(uuid.uuid4());job=http('/api/deployments/'+deployment['id']+'/start',{'requestId':identity,'maxRunMs':30000})
        wait(lambda:(s:=snapshot())['status']['job'] and s['status']['job']['id']==job['id'] and s['live']['samples']['Robot.Velocity.Linear.X']['value'] is not None and s['live']['samples']['Robot.Velocity.Linear.X']['value']>.02,10)
        return identity,job
    identity,job=begin()
    def load():
        for _ in range(12):
            try:http('/api/snapshot/live')
            except urllib.error.URLError:pass
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        readers=[pool.submit(load) for _ in range(4)]
        started=time.monotonic();reply=http('/api/control/live/stop',{});elapsed=time.monotonic()-started
        assert reply['safety']['confirmed'],reply
        assert elapsed<4,elapsed
        state=wait(stopped)
        for reader in readers:reader.result()
    record('priority Stop during actual physical Hold with four concurrent snapshot readers',{'elapsedSeconds':elapsed,'jobId':job['id'],'confirmed':reply['safety']['confirmed'],'velocity':state['sim']['velocity']})
    identity,job=begin()
    subprocess.run(['docker','restart','--time','8','sr-runner-live-1'],check=True,timeout=20,stdout=subprocess.DEVNULL)
    wait(target_ready);state=wait(stopped)
    assert snapshot()['status']['job'] is None
    time.sleep(2);assert snapshot()['status']['job'] is None
    try:http('/api/deployments/'+deployment['id']+'/start',{'requestId':identity})
    except urllib.error.HTTPError as error:assert error.code==409
    else:raise AssertionError('spent request replayed after runner restart')
    record('runner restart while holding stops physically and cannot resume/replay',{'jobId':job['id'],'velocity':state['sim']['velocity'],'replayRejected':True})
    identity,job=begin()
    subprocess.run(['docker','stop','--time','8','sr-studio-api-1'],check=True,timeout=20,stdout=subprocess.DEVNULL)
    assert http('/api/control',{'action':'stop'},base=DOG)['accepted']
    state=wait(stopped)
    subprocess.run(['docker','start','sr-studio-api-1'],check=True,timeout=15,stdout=subprocess.DEVNULL)
    wait(target_ready)
    prior=snapshot()['status']['job'];time.sleep(2);after=snapshot()['status']['job']
    assert prior['id']==after['id']==job['id'] and after['phase']!='RUNNING'
    try:http('/api/deployments/'+deployment['id']+'/start',{'requestId':identity})
    except urllib.error.HTTPError as error:assert error.code==409
    else:raise AssertionError('spent request replayed after API restart')
    record('independent Robot Zoo Stop while Studio API is offline; restart does not replay',{'jobId':job['id'],'phase':after['phase'],'velocity':state['sim']['velocity'],'replayRejected':True})
    (OUT/'live-restart-faults.json').write_text(json.dumps({'passed':True,'results':results},indent=2));print(json.dumps({'passed':True,'cases':len(results)}))

if __name__=='__main__':
    with open('/tmp/sr-live-ui.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        try:main()
        finally:
            try:http('/api/control',{'action':'stop'},base=DOG)
            finally:
                subprocess.run(['docker','start','sr-studio-api-1'],check=False,timeout=15,stdout=subprocess.DEVNULL)
                try:http('/api/control/live/stop',{})
                except Exception:pass

"""Explicit 30-minute RW-B mission cycling, bounded native runs and real ROS measurements."""
import fcntl,json,math,subprocess,time,urllib.request,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]/'robotics';OUT=ROOT/'runtime/m27/workflow-soak';BASE='http://127.0.0.1:3180'
NAMES=['sr-'+n+'-1' for n in ['studio-api','runner-live','studio-web','rflowc','protobus-live','protobus-ros2']]+['dog-ros2-r1-'+n+'-1' for n in ['sim','brain','render','slam','perception','nav2','gateway']]
def request(path,body=None):
    value=urllib.request.Request(BASE+'/api'+path,data=None if body is None else json.dumps(body).encode(),headers={'Origin':BASE,'Content-Type':'application/json'})
    with urllib.request.urlopen(value,timeout=15) as response:return json.load(response)
def write(name,value): (OUT/name).write_text(json.dumps(value,indent=2)+'\n')
def main():
    OUT.mkdir(parents=True,exist_ok=False)
    subprocess.run(['python3',str(ROOT/'protobus/bridge_tests/prepare_live_world.py')],check=True,timeout=75)
    end=time.monotonic()+30
    while True:
        frame=request('/snapshot/live')
        if frame['live'].get('online'):break
        assert time.monotonic()<end,'provider did not become ready';time.sleep(.2)
    project=request('/projects',{'name':'M27 RW-B 30-minute physical mission soak','template':'RW-B'})
    built=request('/projects/'+project['id']+'/build',{'revision':project['revision'],'authorizeSimArm':True,'mode':'live'});assert built['ok'],built
    deployment=request('/deployments',{'buildId':built['build']['id'],'mode':'live'})
    write('deployment.json',deployment)
    started=time.monotonic();measure_next=started;missions=[];resources=[];positions=[];positive=negative=moving=False
    with (OUT/'observations.jsonl').open('w') as observations,(OUT/'resources.jsonl').open('w') as resource_file:
        while time.monotonic()-started<1800:
            job=request('/deployments/'+deployment['id']+'/start',{'requestId':str(uuid.uuid4()),'maxRunMs':120000})
            cursor=0;events=[];complete=False;deadline=time.monotonic()+115
            while time.monotonic()<deadline:
                now=time.monotonic()
                if now>=measure_next:
                    raw=subprocess.check_output(['docker','stats','--no-stream','--format','{{json .}}']+NAMES,text=True,timeout=20)
                    values=[json.loads(line) for line in raw.splitlines()];rss={}
                    for name in ['sr-studio-api-1','sr-runner-live-1','sr-protobus-live-1','sr-protobus-ros2-1']:
                        code="import json;print(json.dumps({line.split(':')[0]:int(line.split()[1])*1024 for line in open('/proc/1/status') if line.startswith(('VmRSS:','VmHWM:'))}))"
                        rss[name]=json.loads(subprocess.check_output(['docker','exec',name,'python3','-c',code],text=True,timeout=8))
                    sample={'elapsedSeconds':now-started,'rss':rss,'stats':values};resources.append(sample);resource_file.write(json.dumps(sample)+'\n');resource_file.flush();measure_next=now+30
                frame=request('/snapshot/live?after='+str(cursor))
                assert frame['status']['job']['id']==job['id'],'unexpected replacement run'
                assert not frame['logs']['gap'],'trace gap'
                for line in frame['logs']['entries']:
                    cursor=line['seq']
                    if line['text'].startswith('RFTRACE '):
                        event=json.loads(line['text'][8:]);events.append(event)
                        if event['event']=='node_started':assert not event['nodeId'].startswith(('failure_','patrol_failure_','obstacle_')),event
                        if event['event']=='log' and event['nodeId']=='complete_log':complete=True
                samples=frame['live'].get('samples',{})
                x=samples.get('Robot.Pose.Position.X',{});v=samples.get('Robot.Velocity.Linear.X',{})
                row={'elapsedSeconds':time.monotonic()-started,'jobId':job['id'],'x':x,'velocity':v};observations.write(json.dumps(row)+'\n');observations.flush()
                if x.get('quality')=='OK' and type(x.get('value')) in (int,float):
                    if positions:
                        positive=positive or x['value']-positions[-1]>.001
                        negative=negative or x['value']-positions[-1]<-.001
                    positions.append(x['value'])
                if v.get('quality')=='OK' and type(v.get('value')) in (int,float):moving=moving or abs(v['value'])>.02
                if complete:break
                assert frame['status']['job']['phase']=='RUNNING',frame['status']['job']
                time.sleep(.2)
            assert complete,'native mission did not finish before bounded deadline'
            goals=[e for e in events if e['event']=='node_finished' and e['nodeId']=='patrol' and e['data']['phase']=='SUCCEEDED']
            assert len(goals)==6,len(goals)
            assert any(e['event']=='node_finished' and e['nodeId']=='complete_disarm' and e['data']['phase']=='SUCCEEDED' and e['data']['physicalConfirmed'] for e in events)
            stop=request('/control/live/stop',{});assert stop['safety']['confirmed'],stop
            mission={'jobId':job['id'],'elapsedSeconds':time.monotonic()-started,'confirmedGoals':len(goals),'stopConfirmed':True};missions.append(mission)
            write('progress.json',{'passed':False,'missions':missions,'elapsedSeconds':time.monotonic()-started})
            print(json.dumps(mission),flush=True)
    assert len(missions)>=5 and positive and negative and moving and min(positions)<-.3 and max(positions)>.3
    warm=[row for row in resources if row['elapsedSeconds']>=120];assert len(warm)>=45
    memory={}
    for name in warm[0]['rss']:
        x=[r['elapsedSeconds']/60 for r in warm];y=[r['rss'][name]['VmRSS'] for r in warm]
        mx=sum(x)/len(x);my=sum(y)/len(y);slope=sum((a-mx)*(b-my) for a,b in zip(x,y))/sum((a-mx)**2 for a in x)
        growth=y[-1]-y[0];assert growth<=16*1024**2 and slope<=.5*1024**2,(name,growth,slope)
        memory[name]={'growthBytes':growth,'bytesPerMinute':slope,'peakRssBytes':max(y)}
    result={'passed':True,'durationSeconds':time.monotonic()-started,'missions':missions,'confirmedGoals':6*len(missions),'positionRangeX':[min(positions),max(positions)],'pythonMemory':memory,'scope':'actual repeated bounded native RW-B / ROS2 / MuJoCo; every Start explicit in this test driver, failures never retried'}
    write('result.json',result);print(json.dumps(result),flush=True)
if __name__=='__main__':
    with open('/tmp/sr-live-ui.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        try:main()
        finally:
            try:request('/control/live/stop',{})
            except Exception:pass

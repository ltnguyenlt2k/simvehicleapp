"""Actual native CLI/ROS/MuJoCo qualification, independent physical gateway observer."""
import json,math,signal,subprocess,sys,threading,time,urllib.request,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUTPUT=ROOT/'runtime/t08'
CLI=['python3',str(ROOT/'scripts/native_cli.py')]
COMPOSE=['docker','compose','-f',str(ROOT/'compose.yaml')]
INFO=json.loads(subprocess.check_output(['docker','run','--rm','--network','none','sr-rfrt:dev','python','-I','-m','rfrt','--runtime-info'],text=True))
TAG=INFO['packageHash'].split(':')[1][:10]

def state():
 with urllib.request.urlopen('http://127.0.0.1:8092/api/state',timeout=3) as response:return json.load(response)

def battery(value):
 subprocess.run(COMPOSE+['exec','-T','protobus-ros2','bash','/opt/protobus/bridge-entrypoint.sh','python3','-m','bridge_tests.sim_battery_stimulus','--soc',str(value)],check=True,timeout=20)

def run(case):
 subprocess.run(['python3',str(Path(__file__).with_name('prepare_live_world.py'))],check=True,timeout=75)
 app='t08-'+case.lower().replace('-','')+'-'+TAG
 assert (ROOT/'runtime/apps'/app).is_dir(),'build exact native template before qualification'
 target='live-'+uuid.uuid4().hex[:12]
 subprocess.run(CLI+['target','--live','--out',target],check=True,timeout=20)
 before=state();epoch=before['brain']['scene_epoch'];origin=before['sim']['position']
 frames=[];errors=[];closing=threading.Event()
 def observe():
  with (OUTPUT/('native-'+case+'-ros-physical.jsonl')).open('w') as log:
   previous=-1
   while not closing.is_set():
    try:
     current=state();brain=current['brain'];sim=current['sim'];stamp=sim['issued_at_ns']
     if stamp!=previous:
      previous=stamp
      value=dict(hostMonotonicNs=time.monotonic_ns(),brainIssuedAtNs=brain['issued_at_ns'],
       simIssuedAtNs=stamp,epoch=brain['scene_epoch'],mode=brain['mode'],mission=brain['mission'],
       missionId=brain.get('mission_id'),motion=brain.get('motion',{}),position=sim['position'],
       finite=sim['finite'],fallen=sim['fallen'],safeCommand=brain['safe_command'],
       appliedCommand=sim['applied_command'],authorityOwner=brain['authority']['owner'])
      frames.append(value);log.write(json.dumps(value)+'\n');log.flush()
    except Exception as error:errors.append(type(error).__name__)
    closing.wait(.025)
 thread=threading.Thread(target=observe,daemon=True);thread.start()
 process=subprocess.Popen(CLI+['run','--live',app,'--target',target,'--events-stdin','--max-run-ms','300000'],
  stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 events=[];injected=False;completed=False
 try:
  with (OUTPUT/('native-'+case+'-ros.log')).open('w') as log:
   for line in process.stdout:
    log.write(line);log.flush()
    if not line.startswith('RFTRACE '):continue
    event=json.loads(line[8:]);events.append(event)
    if event['event']=='bus_bound' and not injected:
     if case=='RW-C':
      time.sleep(.1);process.stdin.write(json.dumps({'schema':'rfevent.v1','id':'live-jump','name':'jump'})+'\n');process.stdin.flush()
     injected=True
    # Stimulate actual single ROS battery publisher only after workflow Arm succeeds.
    if case=='RW-D' and event['event']=='node_finished' and event['nodeId']=='setup_arm' and event['data']['phase']=='SUCCEEDED':battery(.12)
    if event['event']=='log' and event['nodeId']==('low_log' if case=='RW-D' else 'complete_log'):
     completed=True
     if case!='RW-D':process.send_signal(signal.SIGTERM)
   code=process.wait(timeout=10);errors_output=process.stderr.read()
  assert code==0,(case,code,errors_output)
  assert completed,(case,'workflow did not reach completion branch')
  time.sleep(.25)
  final=state();closing.set();thread.join(5)
  assert frames and not errors,errors
  assert all(f['epoch']==epoch and f['finite'] and not f['fallen'] for f in frames)
  assert len({f['simIssuedAtNs'] for f in frames})>20
  assert final['brain']['mode']=='SAFE_STOP' and final['brain']['authority']['owner'] is None
  assert final['brain']['safe_command']==[0.,0.] and final['sim']['applied_command']==[0.,0.,0.]
  starts=[e['nodeId'] for e in events if e['event']=='node_started']
  assert not any(name.startswith('failure_') or name.startswith('patrol_failure_') for name in starts),starts
  assert any(e['event']=='safety_stop_result' and e['data']['physicalConfirmed'] for e in events)
  expected={'RW-A':['lift','bow','complete_disarm'],'RW-B':['patrol','complete_disarm'],
            'RW-C':['jump','complete_disarm'],'RW-D':['crouch','low_disarm','low_stop']}[case]
  for name in expected:
   assert any(e['event']=='node_finished' and e['nodeId']==name and e['data']['phase']=='SUCCEEDED' and e['data']['physicalConfirmed'] for e in events),(case,name)
  motions={f['motion'].get('name') for f in frames if f['motion'].get('phase')=='SUCCEEDED'}
  actual_names={'RW-A':{'lift_fl','bow'},'RW-C':{'jump'},'RW-D':{'crouch'}}.get(case,set())
  assert actual_names<=motions,(case,actual_names,motions)
  distance=max(math.dist(origin[:2],f['position'][:2]) for f in frames)
  if case=='RW-B':
   goals=[e for e in events if e['event']=='node_finished' and e['nodeId']=='patrol' and e['data']['phase']=='SUCCEEDED']
   assert len(goals)==6 and distance>.5,(len(goals),distance)
  if case=='RW-C':assert max(f['motion'].get('max_airborne_s',0) for f in frames)>.05
  if case=='RW-D':
   cancelled=next(e for e in events if e['event']=='node_finished' and e['nodeId']=='cancel')
   assert cancelled['data']['phase']=='SUCCEEDED' and cancelled['data']['executionId']==''
   # This template's concurrent main loop is read-only; Cancel correctly has no body work.
   observed=min(frames,key=lambda f:abs(f['hostMonotonicNs']-int(cancelled['monotonicNs'])))
   assert observed['mode']=='MANUAL' and not observed['motion'].get('active',False),observed
   arm=next(e for e in events if e['event']=='node_finished' and e['nodeId']=='setup_arm')
   trigger=next(e for e in events if e['event']=='behavior_started' and e['nodeId']=='battery_low')
   assert int(trigger['monotonicNs'])-int(arm['monotonicNs'])>=5_000_000_000
  result=dict(passed=True,case=case,scope='actual native application / ROS / Brain / MuJoCo; SIM only',
   runId=events[0]['runId'],runtimePackageHash=INFO['packageHash'],frames=len(frames),sceneEpoch=epoch,
   observedSucceededMotions=sorted(motions),maxDisplacementM=distance,target=target,
   finalMode=final['brain']['mode'],finalOwner=final['brain']['authority']['owner'])
  (OUTPUT/('native-'+case+'-ros-result.json')).write_text(json.dumps(result,indent=2)+'\n')
  print(json.dumps(result),flush=True)
  return result
 finally:
  if process.poll() is None:process.send_signal(signal.SIGTERM);process.wait(timeout=15)
  closing.set();thread.join(5)
  if case=='RW-D':battery(.92)

if __name__=='__main__':
 results=[run(case) for case in (sys.argv[1:] or ['RW-A','RW-B','RW-C','RW-D'])]
 (OUTPUT/'native-templates-ros.json').write_text(json.dumps(results,indent=2)+'\n')

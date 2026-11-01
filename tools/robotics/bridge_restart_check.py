"""Physical bridge restart gate; explicit bounded fixture, no automatic run retry."""
import concurrent.futures,fcntl,json,subprocess,time,urllib.error,uuid
from live_acceptance_faults import http,wait,snapshot,stopped,target_ready,OUT

def main():
    project=next(p for p in http('/api/projects')['projects'] if p['name']=='M27 physical Hold restart faults')
    project=http('/api/projects/'+project['id'])
    hold=next(node for node in project['workflow']['nodes'] if node['id']=='hold')
    assert hold['block']=='rf.move' and hold['props']['durationMs']==10000
    built=http('/api/projects/'+project['id']+'/build',{'revision':project['revision'],'authorizeSimArm':True,'mode':'live'});assert built['ok']
    deployment=http('/api/deployments',{'buildId':built['build']['id'],'mode':'live'})
    identity=str(uuid.uuid4());job=http('/api/deployments/'+deployment['id']+'/start',{'requestId':identity,'maxRunMs':30000})
    def moving():
        frame=snapshot();value=frame['live'].get('samples',{}).get('Robot.Velocity.Linear.X',{}).get('value')
        return frame if isinstance(value,(int,float)) and abs(value)>.02 else None
    wait(moving,10)
    started=time.monotonic()
    def observe_stop():
        state=wait(stopped,10);return time.monotonic()-started,state
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        observed=pool.submit(observe_stop)
        subprocess.run(['docker','restart','--time','8','sr-protobus-ros2-1'],check=True,timeout=25,stdout=subprocess.DEVNULL)
        elapsed,state=observed.result()
    assert elapsed<3,(elapsed,state)
    wait(target_ready,25)
    wait(lambda:snapshot()['status']['job']['phase']!='RUNNING',10)
    prior=snapshot()['status']['job'];time.sleep(2);after=snapshot()['status']['job']
    assert prior['id']==after['id']==job['id'] and after['phase']!='RUNNING'
    try:http('/api/deployments/'+deployment['id']+'/start',{'requestId':identity})
    except urllib.error.HTTPError as error:assert error.code==409
    else:raise AssertionError('spent Start replayed after bridge restart')
    result={'passed':True,'scope':'actual bridge restart mid physical Hold','jobId':job['id'],'physicalStopSeconds':elapsed,'velocity':state['sim']['velocity'],'owner':state['brain']['authority']['owner'],'phase':after['phase'],'replayRejected':True}
    (OUT/'live-bridge-restart.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':
    with open('/tmp/sr-live-ui.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        try:main()
        finally:
            try:http('/api/control/live/stop',{})
            except Exception:pass

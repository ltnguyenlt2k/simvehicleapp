"""Actual Studio HTTP -> compiler -> immutable volume -> native runner -> broker/mock."""
import json,time,uuid
import httpx

with httpx.Client(base_url='http://studio-api:8010',headers={'Origin':'http://localhost:3180'},timeout=15) as client:
    project=client.post('/projects',json={'name':'Backend native qualification','template':'RW-C'})
    project.raise_for_status();project=project.json()
    built=client.post('/projects/'+project['id']+'/build',json={'revision':1,'authorizeSimArm':True,'mode':'sim'})
    built.raise_for_status();assert built.json()['ok'],built.text
    build=built.json()['build']
    deployed=client.post('/deployments',json={'buildId':build['id'],'mode':'sim'})
    deployed.raise_for_status();deployed=deployed.json()
    frame=client.get('/snapshot/sim');frame.raise_for_status();before=frame.json()
    assert before['status']['job'] is None,'create/build/deploy unexpectedly started an application'
    assert before['live']['online']
    started=client.post('/deployments/'+deployed['id']+'/start',json={'requestId':str(uuid.uuid4()),'maxRunMs':30000})
    started.raise_for_status();job=started.json()
    overlapping=client.post('/deployments/'+deployed['id']+'/start',json={'requestId':str(uuid.uuid4())})
    assert overlapping.status_code==409,overlapping.text
    deadline=time.monotonic()+20;events=[];cursor=0;sent=False;complete=False
    while time.monotonic()<deadline:
        response=client.get('/snapshot/sim',params={'after':cursor});response.raise_for_status();frame=response.json()
        for line in frame['logs']['entries']:
            cursor=line['seq']
            if not line['text'].startswith('RFTRACE '):continue
            event=json.loads(line['text'][8:]);events.append(event)
            if event['event']=='bus_bound' and not sent:
                time.sleep(.1)
                event_id=str(uuid.uuid4())
                for _ in range(2):
                    reply=client.post('/control/sim/event',json={'id':event_id,'name':'jump'});reply.raise_for_status()
                sent=True
            if event['event']=='log' and event['nodeId']=='complete_log':complete=True
        if complete:break
        time.sleep(.05)
    assert complete and sent,{'status':frame['status'],'events':events[-8:]}
    assert sum(e['event']=='node_started' and e['nodeId']=='jump' for e in events)==1
    assert any(e['event']=='node_finished' and e['nodeId']=='jump' and e['data']['phase']=='SUCCEEDED' and e['data']['physicalConfirmed'] for e in events)
    stopped=client.post('/control/sim/stop');stopped.raise_for_status()
    assert stopped.json()['safety']['confirmed'],stopped.text
    after=client.get('/snapshot/sim').json()
    assert after['status']['job']['phase']=='STOPPED',after['status']
    assert after['live']['samples']['Robot.Velocity.Linear.X']['value']==0
    # Probe the actual service topology, not a substitute listener.
    print(json.dumps({'passed':True,'scope':'actual backend/native application / kinematic mock only',
        'projectId':project['id'],'buildId':build['id'],'deploymentId':deployed['id'],
        'artifactHash':build['artifactHash'],'runId':job['id'],'duplicateEventStarts':1,
        'overlapRefused':True,'deployDidNotStart':True,'stopConfirmed':True,'observedRuntimeEvents':len(events)}),flush=True)

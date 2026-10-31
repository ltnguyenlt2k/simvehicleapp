"""Actual installed CLI + independent broker/mock smoke; synthetic only."""
import asyncio,base64,json,signal,sys,tempfile,time
from google.protobuf import descriptor_pool,message_factory,json_format
from pathlib import Path
import grpc
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc
from rfrt.transport import TargetBinding
from rfrt.launch import runtime_info,load_application

async def main():
 channel=grpc.aio.insecure_channel('broker:55600');bus=rpc.BusStub(channel)
 try:
  deadline=time.monotonic()+20
  while True:
   descriptor=await bus.Describe(pb.Empty(),timeout=2)
   if descriptor.provider_online and descriptor.provider_session:break
   if time.monotonic()>deadline:raise AssertionError('provider unavailable')
   await asyncio.sleep(.1)
  assert descriptor.protocol_version=='1.6'
  assert descriptor.target_context.kind==pb.KINEMATIC_MOCK
  mock_channel=grpc.aio.insecure_channel('mock:55601')
  reset=mock_channel.unary_unary('/protobus.mock.v1.MockControl/Reset')
  pool=descriptor_pool.Default()
  pool.AddSerializedFile(base64.b64decode(Path('/apps/mock-descriptor.b64').read_text()))
  Scenario=message_factory.GetMessageClass(pool.FindMessageTypeByName('protobus.mock.v1.ScenarioRequest'))
  schedule=mock_channel.unary_unary('/protobus.mock.v1.MockControl/Schedule',request_serializer=lambda m:m.SerializeToString())
  for name in (sys.argv[1:] or ['hold','RW-C','parallel-all','parallel-any','parallel-cancel','parallel-stop']):
   old_session=descriptor.provider_session
   reset_by=time.monotonic()+3
   while True:
    try:
     # Empty wire is the closed ResetRequest default (time_scale=0); mock-only API.
     await reset(b'',timeout=1);break
    except grpc.aio.AioRpcError as error:
     if error.code()!=grpc.StatusCode.FAILED_PRECONDITION or time.monotonic()>reset_by:raise
     await asyncio.sleep(.05)
   while True:
    descriptor=await bus.Describe(pb.Empty(),timeout=2)
    if descriptor.provider_online and descriptor.provider_session!=old_session:break
    if time.monotonic()>reset_by:raise AssertionError('mock reset did not replace session')
    await asyncio.sleep(.05)
   with tempfile.TemporaryDirectory() as folder:
    root=Path(folder)/'app';root.mkdir();source=Path('/apps')/name
    for path in source.rglob('*'):
     if path.is_file():
      target=root/path.relative_to(source);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(path.read_bytes())
    load_application(root)
    target=Path(folder)/'target.json';record=TargetBinding.record(descriptor).record_json()
    if name=='binding-mismatch':record['robotId']='wrong-dog'
    target.write_text(json.dumps(record))
    command=[sys.executable,'-I','-m','rfrt','--root',str(root),'--target',str(target),'--bus','broker:55600','--max-run-ms','120000' if name=='typed-patrol' else '30000']
    if name in ('RW-C','event-invalid') or name.startswith('policy-'):command+=['--events-stdin']
    process=await asyncio.create_subprocess_exec(*command,stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
    events=[];event_sent=False;terminated=False;burst_sent=False;scheduled_at=None
    try:
     async def read():
      nonlocal event_sent,terminated,burst_sent,scheduled_at
      while True:
       line=await process.stdout.readline()
       if not line:return
       text=line.decode().strip();print(text,flush=True)
       if not text.startswith('RFTRACE '):continue
       event=json.loads(text[8:]);events.append(event)
       if name=='event-invalid' and event['event']=='bus_bound' and not event_sent:
        process.stdin.write(b'{"schema":"rfevent.v1","id":"bad","name":"undeclared"}\n');await process.stdin.drain();event_sent=True
       if name.startswith('result-') and event['event']=='bus_bound' and not event_sent:
        request=json_format.ParseDict({'steps':[{'atMs':0,'commandResult':{'path':'Robot.Motion.Perform','phase':name[7:],'count':1}}]},Scenario())
        await schedule(request,timeout=2);event_sent=True
       if name=='sigterm' and event['event']=='node_started' and event['nodeId']=='move' and not terminated:
        async def stop_body():
         await asyncio.sleep(.25);process.send_signal(signal.SIGTERM)
        asyncio.create_task(stop_body());terminated=True
       if event['event']=='bus_bound' and not event_sent:
        if name=='RW-C' or name.startswith('policy-'):
         await asyncio.sleep(.1)
         data=json.dumps(dict(schema='rfevent.v1',id='conformance-event',name='jump' if name=='RW-C' else 'pulse')).encode()+b'\n'
         process.stdin.write(data+data if name=='RW-C' else data);await process.stdin.drain();event_sent=True
        elif name=='condition':
         await asyncio.sleep(.1)
         steps=[]
         for at,value,quality in [(0,1,'OK'),(70,0,'OK'),(160,1,'OK'),(220,None,'NONE'),(320,1,'OK'),(650,0,'OK'),(850,1,'OK')]:
          sensor=dict(path='Robot.Perception.Marker.Count',quality=quality)
          if value is not None:sensor['value']={'uint32Value':value}
          steps.append(dict(atMs=at,sensor=sensor))
         scheduled_at=time.monotonic();await schedule(json_format.ParseDict({'steps':steps},Scenario()),timeout=2)
         async def stop_condition():
          await asyncio.sleep(1.3);process.send_signal(signal.SIGTERM)
         asyncio.create_task(stop_condition());event_sent=True
       if name.startswith('policy-') and event['event']=='node_started' and event['nodeId']=='delay' and not burst_sent:
        burst_sent=True
        data=b''.join((json.dumps(dict(schema='rfevent.v1',id='pulse-'+str(i),name='pulse')).encode()+b'\n') for i in range(3))
        process.stdin.write(data);await process.stdin.drain()
        async def stop_policy():
         await asyncio.sleep(1);process.send_signal(signal.SIGTERM)
        asyncio.create_task(stop_policy())
       if event['event']=='log' and ((name=='RW-C' and 'Đã nhảy' in json.dumps(event,ensure_ascii=False)) or (name=='typed-patrol' and event['nodeId']=='complete_log')) and not terminated:
        process.send_signal(signal.SIGTERM);terminated=True
     await asyncio.wait_for(read(),130 if name=='typed-patrol' else 35)
     code=await asyncio.wait_for(process.wait(),3);errors=(await process.stderr.read()).decode()
     assert code==(2 if name=='binding-mismatch' else 3 if name.startswith('result-') or name=='event-invalid' else 0),(name,code,errors)
     starts=[e for e in events if e['event']=='node_started']
     if name not in ('event-invalid','binding-mismatch'):assert starts and all(e['nodeId'] for e in starts)
     elif name=='event-invalid':assert not starts and any(e['event']=='safety_stop_result' and e['data']['physicalConfirmed'] for e in events)
     else:assert not starts and not any(e['event']=='bus_bound' for e in events)
     assert [e['seq'] for e in events]==list(range(1,len(events)+1))
     finished=[e['data']['span'] for e in events if e['event']=='node_finished']
     assert sorted(e['seq'] for e in starts)==sorted(finished),'incomplete node spans'
     lock=json.loads((root/'rflow.lock.json').read_text())
     assert events[0]['data']['identities']['artifactHash']==lock['artifactHash']
     if name=='hold':
      assert any(e['nodeId']=='move' for e in starts)
      assert any(e['nodeId']=='bow' for e in starts)
      releases=[e for e in events if e['event']=='target_release_result' and e['data']['physicalConfirmed']]
      assert len(releases)==1 and int(releases[0]['data']['targetSequence'])>=4,releases
      assert releases[0]['seq']<next(e['seq'] for e in starts if e['nodeId']=='bow')
      samples=await bus.Get(pb.Query(catalog_hash=descriptor.catalog_hash,paths=['Robot.Pose.Position.X','Robot.Velocity.Linear.X']),timeout=2)
      snapshot={e.path:e for e in samples.samples}
      assert .06<snapshot['Robot.Pose.Position.X'].value.float64_value<.12,snapshot
      assert snapshot['Robot.Velocity.Linear.X'].value.float64_value==0.
      assert any('hold-then-bow-complete' in json.dumps(e) for e in events)
     elif name=='RW-C':
      assert sum(e['nodeId']=='jump' for e in starts)==1,'duplicate event replayed'
      assert terminated,'event flow never completed'
     if name=='typed-patrol':
      logs=[e['data']['message'] for e in events if e['event']=='log' and e['nodeId']=='distance_log']
      assert len(logs)==2,logs
      assert all(abs(float(text.split('=')[1])-expected)<1e-9 for text,expected in zip(logs,[.3,.4])),logs
      goals=[e for e in events if e['event']=='node_finished' and e['nodeId']=='patrol' and e['data']['phase']=='SUCCEEDED']
      assert len(goals)==6,goals
      iterations=[e for e in events if e['event']=='iteration_started' and e['nodeId']=='patrol_loop']
      assert [e['data']['index'] for e in iterations]==[0,1],iterations
     if name.startswith('result-'):
      body=[e for e in events if e['event']=='node_finished' and e['nodeId']=='body']
      assert len(body)==1 and body[0]['data']['phase']==name[7:],body
      assert any(e['event']=='log' and e['data']['message']=='observed-'+name[7:].lower() for e in events),name
     if name=='sigterm':
      assert terminated and not any(e['nodeId']=='bow' for e in starts)
      assert any(e['event']=='stop_confirmed' for e in events)
     if name.startswith('policy-'):
      logs=[e for e in events if e['event']=='log' and e['nodeId']=='observed']
      expected=2 if name=='policy-queue' else 1
      assert len(logs)==expected,(name,len(logs),expected)
      started=[e for e in events if e['event']=='node_started' and e['nodeId']=='delay']
      assert len(started)==(2 if name in ('policy-queue','policy-restart') else 1),(name,len(started))
     if name=='condition':
      logs=[e for e in events if e['event']=='log' and e['nodeId']=='observed']
      assert len(logs)==2,logs
      assert int(logs[0]['monotonicNs'])/1e9-scheduled_at>=.38,logs
      assert int(logs[1]['monotonicNs'])/1e9-scheduled_at>=.90,logs
     if name.startswith('parallel-'):
      body=[e for e in events if e['event']=='node_finished' and e['nodeId']=='body']
      assert len(body)==1,(name,body)
      if name in ('parallel-any','parallel-cancel'):
       assert body[0]['data']['phase']=='CANCELLED',body
       if name=='parallel-cancel':assert body[0]['data']['physicalConfirmed'],body
       else:
        release=[e for e in events if e['event']=='target_release_result' and e['data']['physicalConfirmed']]
        assert len(release)==1,'no correlated losing Hold release proof'
        assert release[0]['seq']<next(e['seq'] for e in starts if e['nodeId']=='complete_disarm')
      if name!='parallel-stop':assert any(e['nodeId']=='complete_disarm' for e in starts)
      else:assert not any(e['nodeId']=='complete_disarm' for e in starts)
     print(json.dumps(dict(case=name,result='PASS',scope='actual broker/kinematic mock only',runtime=runtime_info(),artifactHash=json.loads((root/'rflow.lock.json').read_text())['artifactHash'])),flush=True)
    finally:
     if process.returncode is None:process.kill();await process.wait()
  await mock_channel.close()
 finally:await channel.close()

asyncio.run(main())

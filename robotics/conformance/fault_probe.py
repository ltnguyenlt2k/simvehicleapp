"""Fault injection around verified native code and the actual SDK/real gRPC."""
import asyncio,json,sys,tempfile,time
from pathlib import Path
import grpc
from protobus.v1 import protobus_pb2 as pb
from protobus.v1 import protobus_pb2_grpc as rpc
from rfrt.transport import TargetBinding,BusTransport
from rfrt.launch import load_application
from rfrt.bus import BusClient
from rfrt.core import Context,Trace,AuthorityLost
from rfrt.engine import Engine

async def main():
 mode=sys.argv[1];channel=grpc.aio.insecure_channel('broker:55600');observer=rpc.BusStub(channel)
 mock_channel=grpc.aio.insecure_channel('mock:55601')
 reset=mock_channel.unary_unary('/protobus.mock.v1.MockControl/Reset')
 old=await observer.Describe(pb.Empty(),timeout=2)
 await reset(b'',timeout=2)
 end=time.monotonic()+5
 while True:
  descriptor=await observer.Describe(pb.Empty(),timeout=2)
  if descriptor.provider_online and descriptor.provider_session!=old.provider_session:break
  if time.monotonic()>end:raise AssertionError('reset session timeout')
  await asyncio.sleep(.05)
 events=[];injected=False;injection=None;client=None
 async def fault():
  await asyncio.sleep(.2)
  if mode=='lease':
   client.tasks[0].cancel();await asyncio.gather(client.tasks[0],return_exceptions=True)
  else:print('FAULT_READY',flush=True)
 def trace(event):
  nonlocal injected,injection
  events.append(event);print('RFTRACE '+json.dumps(event),flush=True)
  if event['event']=='node_started' and event['nodeId']=='move' and not injected:
   injected=True;injection=asyncio.create_task(fault())
 try:
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);source=Path('/apps/lease-loss')
   for path in source.rglob('*'):
    if path.is_file():
     target=root/path.relative_to(source);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(path.read_bytes())
   app,lock,behaviors=load_application(root)
   sink=Trace(lock,trace)
   client=BusClient(BusTransport('broker:55600',app.json('rss-catalog.json'),TargetBinding.record(descriptor)),sink)
   await client.open(True)
   context=Context(client,app.json('rss-catalog.json'),app.json('rfir.json')['vars'],app.json('units.v1.json'),sink,time.monotonic()+8)
   result=await asyncio.wait_for(Engine(context,behaviors).run(),10)
   assert injected and client.fault,(mode,result)
   assert not result.ok
   assert not any(e['event']=='node_started' and e['nodeId']=='bow' for e in events)
   assert sum(e['event']=='bus_bound' for e in events)==1
   with_rejected=False
   try:await client.invoke('Robot.Safety.Arm',{},1000)
   except AuthorityLost:with_rejected=True
   assert with_rejected,'lost authority was silently reacquired'
   if mode=='lease':
    stop=await client.stop(1000);assert stop.physical_confirmed,stop
   else:
    until=time.monotonic()+5
    while True:
     current=await observer.Describe(pb.Empty(),timeout=2)
     if current.provider_online and current.provider_session!=descriptor.provider_session:break
     if time.monotonic()>until:raise AssertionError('replacement provider unavailable')
     await asyncio.sleep(.05)
    snapshot=await observer.Get(pb.Query(catalog_hash=descriptor.catalog_hash,paths=['Robot.Safety.Mode','Robot.Velocity.Linear.X']),timeout=2)
    values={item.path:item for item in snapshot.samples}
    assert values['Robot.Safety.Mode'].value.string_value in ('DISARMED','SAFE_STOP')
    assert values['Robot.Velocity.Linear.X'].quality==pb.OK
    assert values['Robot.Velocity.Linear.X'].value.float64_value==0.
    assert client.fault,'new provider implicitly healed old run'
   try:await client.close()
   except AuthorityLost:
    if mode!='provider':raise
   print(json.dumps(dict(case='fault-'+mode,result='PASS',scope='actual broker/kinematic mock only',artifactHash=lock['artifactHash'])),flush=True)
 finally:
  if injection is not None:await injection
  if client is not None:
   try:await client.close()
   except AuthorityLost:pass
  await channel.close();await mock_channel.close()

asyncio.run(main())

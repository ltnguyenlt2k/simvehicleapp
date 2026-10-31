"""Verify exact app/runtime bytes before loading native generated flow code."""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import signal
import sys
import time
from jsonschema import Draft202012Validator
from protobus.v1 import protobus_pb2 as pb

from .artifact import ArtifactError,META,SCHEMAS,decode,verify_application
from .bus import BusClient
from .core import Context,Trace,drain
from .engine import Engine
from .transport import BusTransport,TargetBinding

WHEEL=Path('/opt/rfrt-runtime/rfrt-0.1.0-py3-none-any.whl')
PIN=Path('/opt/rfrt-runtime/package.sha256')
LEASE_BLOCKS={'rf.arm','rf.disarm','rf.reset_stop','rf.move','rf.go_to','rf.patrol','rf.perform','rf.cancel'}


def runtime_info():
    actual='sha256:'+hashlib.sha256(WHEEL.read_bytes()).hexdigest()
    if PIN.read_text().strip()!=actual:raise ArtifactError('installed runtime wheel identity differs')
    return dict(schema='rfrt-capabilities.v1',runtimeVersion='0.1.0',packageHash=actual,
        protocolVersion='1.6',backend='SIM')


def load_application(root):
    package=runtime_info()['packageHash']
    app=verify_application(root,package);lock=app.json('rflow.lock.json')
    namespace={'__name__':'robotflow_verified_flow'}
    exec(compile(app.files['app/flow.py'],'verified:app/flow.py','exec'),namespace)
    expected={key:lock[key] for key in (*META,'runtimePackageHash')}
    if namespace.get('FLOW_META')!=expected:raise ArtifactError('native flow identities differ from lock')
    behaviors=namespace.get('BEHAVIORS')
    if not isinstance(behaviors,list) or not all(callable(item.get('handler')) for item in behaviors):
        raise ArtifactError('native behavior entrypoints missing')
    return app,lock,behaviors


async def events(reader,engine):
    validator=Draft202012Validator(decode((SCHEMAS/'rfevent.v1.json').read_bytes()))
    while True:
        raw=await reader.readline()
        if not raw:return
        if len(raw)>2048:raise ValueError('event input exceeds 2048 bytes')
        value=decode(raw)
        validator.validate(value)
        if (not isinstance(value,dict) or set(value)!= {'schema','id','name'} or value['schema']!='rfevent.v1'):
            raise ValueError('closed rfevent.v1 input required')
        engine.event(value['name'],value['id'])


async def execute(root,target_path,address,max_run_ms=None,stdin=False):
    app,lock,behaviors=load_application(root)
    target=Path(target_path)
    if target.stat().st_size>65536:raise ValueError('target binding exceeds 64 KiB')
    binding=TargetBinding.from_json(decode(target.read_bytes()))
    if binding.catalog_hash!=lock['catalogHash'] or binding.profile_id!=lock['profileId']:
        raise ArtifactError('deployment target differs from compiled artifact')
    profile=app.json('profile.json');limit=profile['limits']['maxRunMs']
    if max_run_ms is not None:
        if not 1<=max_run_ms<=limit:raise ValueError('run limit outside compiled policy')
        limit=max_run_ms
    workflow=app.json('workflow.json')
    target_context=pb.TargetContext.FromString(binding.context_bytes)
    if (target_context.kind==pb.ROS_SIM and any(item['block'] in ('rf.go_to','rf.patrol') for item in workflow['nodes'])
            and target_context.scene_id!=profile['navigation']['sceneId']):
        raise ArtifactError('navigation scene differs from commissioned compiler policy')
    control=any(item['block'] in LEASE_BLOCKS for item in workflow['nodes'])
    metadata={**{key:lock[key] for key in (*META,'runtimePackageHash')},'artifactHash':lock['artifactHash']}
    trace=Trace(metadata);bus=BusClient(BusTransport(address,app.json('rss-catalog.json'),binding),trace)
    engine=None;run=None;input_task=None;input_transport=None;signal_task=None
    loop=asyncio.get_running_loop();signals=[]
    startup_ready=asyncio.Event()
    async def terminate():
        await startup_ready.wait()
        if bus.transport.descriptor is None:return
        result=await bus.stop(1500)
        trace.emit(None,'stop_confirmed' if result.ok and result.physical_confirmed else 'stop_unconfirmed',phase=result.phase)
        if engine is not None:
            engine.result=type(result)('CANCELLED','explicit process stop') if result.ok else result
            engine.finished.set()
        else:trace.emit(None,'run_finished',phase='CANCELLED' if result.ok else result.phase)
    def requested():
        nonlocal signal_task
        if signal_task is None:signal_task=asyncio.create_task(terminate())
    try:
        for selected in (signal.SIGTERM,signal.SIGINT):
            loop.add_signal_handler(selected,requested);signals.append(selected)
        try:await bus.open(control)
        finally:startup_ready.set()
        if signal_task is not None:
            await signal_task
            return 0 if bus.stop_task is not None and bus.stop_task.result().ok else 3
        context=Context(bus,app.json('rss-catalog.json'),app.json('rfir.json')['vars'],app.json('units.v1.json'),trace,
            time.monotonic()+limit/1000)
        engine=Engine(context,behaviors)
        run=asyncio.create_task(engine.run())
        if stdin:
            reader=asyncio.StreamReader(limit=2048)
            input_transport,_=await loop.connect_read_pipe(lambda:asyncio.StreamReaderProtocol(reader),sys.stdin.buffer)
            input_task=asyncio.create_task(events(reader,engine))
            done,_=await asyncio.wait([run,input_task],return_when=asyncio.FIRST_COMPLETED)
            if input_task in done and input_task.exception() is not None:
                engine.fail(type(engine.result)('FAILED','invalid event input'))
        result=await run
        if bus.fault:return 3
        return 0 if result.ok or result.phase=='CANCELLED' and bus.stop_requested else 3
    finally:
        if input_task is not None and not input_task.done():input_task.cancel()
        if input_task is not None:await drain([input_task])
        if run is not None and not run.done():run.cancel();await drain([run])
        if signal_task is not None:await drain([signal_task])
        await bus.close()
        if signal_task is not None:await drain([signal_task])
        for selected in signals:loop.remove_signal_handler(selected)
        if input_transport is not None:input_transport.close()


def run_app(root=None):
    parser=argparse.ArgumentParser(description='Run an immutable RobotFlow application on its recorded SIM target')
    parser.add_argument('--root',default=str(root) if root is not None else None)
    parser.add_argument('--target');parser.add_argument('--bus',default='protobus-sim:55600')
    parser.add_argument('--max-run-ms',type=int);parser.add_argument('--events-stdin',action='store_true')
    parser.add_argument('--runtime-info',action='store_true')
    args=parser.parse_args()
    try:
        if args.runtime_info:print(json.dumps(runtime_info(),sort_keys=True));return 0
        if not args.root or not args.target:parser.error('--root and --target are required')
        return asyncio.run(execute(args.root,args.target,args.bus,args.max_run_ms,args.events_stdin))
    except Exception as error:
        # Never echo user JSON, lease replies or raw transport errors.
        print(json.dumps({'schema':'rfrt-error.v1','stage':'launch','kind':type(error).__name__,
            'message':'Runtime artifact, target or execution check failed'}),file=sys.stderr,flush=True)
        return 2

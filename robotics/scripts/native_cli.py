"""Host developer CLI. Container arguments remain argv, never shell text."""
import argparse
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import time
import uuid
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1]
RUNTIME=ROOT/'runtime'
EXPECTED={'app/__init__.py','app/flow.py','app/main.py','rfir.json','rss-catalog.json',
          'profile.json','units.v1.json','registry.json','workflow.json','rflow.lock.json'}


def name(value):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}',value):
        raise argparse.ArgumentTypeError('name requires 1..64 letters, numbers, underscore or hyphen')
    return value


def checked_json(command, data=None):
    result=subprocess.run(command,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if result.returncode:
        try:
            value=json.loads(result.stdout)
            if 'diagnostics' in value:
                print(json.dumps({'ok':False,'diagnostics':value['diagnostics']},ensure_ascii=False))
        except (ValueError,TypeError):
            pass
        raise RuntimeError('container operation failed; no artifact was published')
    return json.loads(result.stdout)


def publish(folder, value):
    folder.parent.mkdir(parents=True,exist_ok=True)
    if folder.exists():raise ValueError('immutable output name already exists')
    temporary=Path(tempfile.mkdtemp(prefix='.build-',dir=folder.parent))
    try:
        for relative,content in value.items():
            path=PurePosixPath(relative)
            if path.is_absolute() or '..' in path.parts or not isinstance(content,str):
                raise ValueError('invalid compiler output file')
            target=temporary.joinpath(*path.parts)
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_text(content,encoding='utf-8',newline='\n')
        # mkdir is exclusive; do not replace any existing name even during a race.
        folder.mkdir()
        try:
            for item in temporary.iterdir():shutil.move(str(item),str(folder/item.name))
        except BaseException:
            shutil.rmtree(folder)
            raise
    finally:
        shutil.rmtree(temporary)


def main():
    parser=argparse.ArgumentParser(description='Native RobotFlow build and explicit SIM target launch')
    commands=parser.add_subparsers(dest='command',required=True)
    build=commands.add_parser('build');build.add_argument('workflow',type=Path)
    build.add_argument('--out',required=True,type=name)
    build.add_argument('--authorize-sim-arm',action='store_true')
    for action in ('target','run'):
        selected=commands.add_parser(action)
        mode=selected.add_mutually_exclusive_group(required=True)
        mode.add_argument('--sim',action='store_true');mode.add_argument('--live',action='store_true')
        if action=='target':selected.add_argument('--out',required=True,type=name)
        else:
            selected.add_argument('app',type=name);selected.add_argument('--target',required=True,type=name)
            selected.add_argument('--max-run-ms',type=int)
            selected.add_argument('--events-stdin',action='store_true')
    args=parser.parse_args()
    if args.command=='build':
        output=RUNTIME/'apps'/args.out
        if output.exists():raise ValueError('immutable application name already exists')
        if args.workflow.stat().st_size>1024*1024:raise ValueError('workflow exceeds 1 MiB')
        info=checked_json(['docker','run','--rm','--network','none','sr-rfrt:dev',
                           'python','-I','-m','rfrt','--runtime-info'])
        command=['docker','run','--rm','-i','--network','none','--read-only','--tmpfs','/tmp',
                 '--cap-drop','ALL','--security-opt','no-new-privileges:true','--pids-limit','64',
                 '--cpus','2','--memory','256m','sr-robotflow:dev','python','-m','cli',
                 '--runtime-package-hash',info['packageHash']]
        if args.authorize_sim_arm:command.append('--authorize-sim-arm')
        result=checked_json(command,args.workflow.read_bytes())
        if not result.get('ok') or set(result.get('files',{}))!=EXPECTED:
            raise ValueError('compiler did not return an exact valid file set')
        publish(output,result['files'])
        lock=json.loads(result['files']['rflow.lock.json'])
        print(json.dumps({'ok':True,'app':args.out,'artifactHash':lock['artifactHash'],
                          'runtimePackageHash':info['packageHash']}))
        return 0
    # Both mount roots exist before Compose; Docker must never create root-owned paths.
    for child in ('apps','targets'):(RUNTIME/child).mkdir(parents=True,exist_ok=True)
    mode='live' if args.live else 'sim'
    address='protobus-'+mode+':55600'
    command=['docker','compose','-f',str(ROOT/'compose.yaml'),'-f',str(ROOT/'cli-compose.yaml'),
             '--profile','native-tools','run','--rm','--no-deps','-T','native-'+mode]
    if args.command=='target':
        output=RUNTIME/'targets'/(args.out+'.json')
        if output.exists():raise ValueError('immutable target name already exists')
        # Installed SDK performs strict context validation. This action is read-only.
        script="""import asyncio,json,grpc
from rfrt.transport import TargetBinding
from protobus.v1 import protobus_pb2 as pb,protobus_pb2_grpc as rpc
async def main():
 async with grpc.aio.insecure_channel(ADDRESS) as channel:
  d=await rpc.BusStub(channel).Describe(pb.Empty(),timeout=3)
  if not d.provider_online or not d.audit_ok or d.backend!='SIM' or d.protocol_version!='1.6':
   raise ValueError('healthy SIM provider required')
  print(json.dumps(TargetBinding.record(d).record_json(),sort_keys=True))
asyncio.run(main())
""".replace('ADDRESS',repr(address))
        value=checked_json(command+['python','-I','-c',script])
        with output.open('x',encoding='utf-8',newline='\n') as file:
            json.dump(value,file,sort_keys=True,indent=2);file.write('\n')
        print(json.dumps({'ok':True,'target':args.out,'kind':value['context']['kind']}))
        return 0
    if not (RUNTIME/'apps'/args.app).is_dir():raise ValueError('application does not exist')
    if not (RUNTIME/'targets'/(args.target+'.json')).is_file():raise ValueError('recorded target does not exist')
    container='sr-native-'+uuid.uuid4().hex
    command[-1:-1]=['--name',container]
    command+=['python','-I','-m','rfrt','--root','/apps/'+args.app,
              '--target','/targets/'+args.target+'.json','--bus',address]
    if args.max_run_ms is not None:command+=['--max-run-ms',str(args.max_run_ms)]
    if args.events_stdin:command.append('--events-stdin')
    stopping=False
    def stop_requested(_signal,_frame):
        nonlocal stopping
        stopping=True
    original={selected:signal.signal(selected,stop_requested) for selected in (signal.SIGTERM,signal.SIGINT)}
    process=None
    try:
        process=subprocess.Popen(command)
        while process.poll() is None:
            if stopping:
                # Container name is generated locally; only this invocation can be stopped.
                stopped=subprocess.run(['docker','stop','--time','3',container],
                                       stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                if stopped.returncode==0:
                    return process.wait(timeout=10)
            time.sleep(.1)
        return process.returncode
    finally:
        for selected,handler in original.items():signal.signal(selected,handler)
        if process is not None and process.poll() is None:
            subprocess.run(['docker','stop','--time','3',container],
                           stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait()

if __name__=='__main__':
    try:raise SystemExit(main())
    except (ValueError,OSError,RuntimeError) as error:
        print(json.dumps({'ok':False,'message':str(error)}),file=sys.stderr)
        raise SystemExit(2)

import ast
import asyncio
import hashlib
import json
from pathlib import Path
import re
import signal
import sys
import tempfile
import unittest
import zipfile

import grpc
from protobus.v1 import protobus_pb2_grpc as rpc
from protobus.v1 import protobus_pb2 as pb
import rfrt
from rfrt.artifact import ArtifactError,canonical,digest
from rfrt.launch import load_application,runtime_info,WHEEL,execute
from rfrt.transport import TargetBinding
import test_bus


def application(root,template='RW-C'):
    files=json.loads((Path('/fixtures')/(template+'.json')).read_text())['files']
    package=runtime_info()['packageHash'];lock=json.loads(files['rflow.lock.json'])
    tree=ast.parse(files['app/flow.py'])
    meta=next(ast.literal_eval(item.value) for item in tree.body if isinstance(item,ast.Assign)
        and any(isinstance(target,ast.Name) and target.id=='FLOW_META' for target in item.targets))
    meta['runtimePackageHash']=package;lock['runtimePackageHash']=package
    files['app/flow.py']=re.sub(r'^FLOW_META = .*$',lambda _: 'FLOW_META = '+repr(meta),files['app/flow.py'],count=1,flags=re.M)
    lock['files']={path:digest(content.encode()) for path,content in files.items() if path!='rflow.lock.json'}
    lock['sourceHash']=digest(canonical({path:value for path,value in sorted(lock['files'].items()) if path.startswith('app/')}))
    lock['artifactHash']=digest(canonical({key:value for key,value in lock.items() if key!='artifactHash'}))
    files['rflow.lock.json']=canonical(lock).decode()+'\n'
    for name,content in files.items():
        path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(content)


class LaunchTests(unittest.IsolatedAsyncioTestCase):
    def test_actual_wheel_hash_and_installed_package_are_used(self):
        self.assertIn('/site-packages/rfrt/',rfrt.__file__)
        self.assertEqual(runtime_info()['packageHash'],'sha256:'+hashlib.sha256(WHEEL.read_bytes()).hexdigest())
        with zipfile.ZipFile(WHEEL) as archive:
            self.assertIn('protobus/v1/protobus_pb2.py',archive.namelist())
            self.assertFalse(any(path.startswith('tests/') for path in archive.namelist()))
            self.assertTrue(all(item.date_time==(1980,1,1,0,0,0) for item in archive.infolist()))
            self.assertIn('rfrt/contracts/rflow-lock.v1.json',archive.namelist())
            self.assertIn('rfrt/contracts/rftarget.v1.json',archive.namelist())
            self.assertTrue(any(path.endswith('/LICENSE') for path in archive.namelist()))

    def test_pinned_fixture_loads_without_running_and_mutation_fails_before_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)/'app';root.mkdir();application(root)
            app,lock,behaviors=load_application(root)
            self.assertEqual(behaviors[0]['trigger'],{'kind':'event','name':'jump'})
            marker=Path(folder)/'executed'
            (root/'app/flow.py').write_text(f'from pathlib import Path\nPath({str(marker)!r}).write_text("bad")\n')
            with self.assertRaises(ArtifactError):load_application(root)
            self.assertFalse(marker.exists())

    async def test_real_child_sigterm_confirms_stop_without_implicit_arm_or_token_output(self):
        catalog=json.loads(Path('/contracts/fixtures/rss-go2-catalog.v1.json').read_text())
        fake=test_bus.FakeControl(catalog)
        fake.descriptor.host_clock_id=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        server=grpc.aio.server();rpc.add_BusServicer_to_server(fake,server)
        port=server.add_insecure_port('127.0.0.1:0');await server.start();process=None
        try:
            with tempfile.TemporaryDirectory() as folder:
                root=Path(folder)/'app';root.mkdir();application(root)
                target=Path(folder)/'target.json';target.write_text(json.dumps(TargetBinding.record(fake.descriptor).record_json()))
                process=await asyncio.create_subprocess_exec(sys.executable,'-I','-m','rfrt','--root',str(root),
                    '--target',str(target),'--bus',f'127.0.0.1:{port}','--max-run-ms','5000',
                    stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
                output=[]
                while True:
                    line=await asyncio.wait_for(process.stdout.readline(),5)
                    self.assertTrue(line,'child exited before binding')
                    output.append(line)
                    if b'"event": "bus_bound"' in line:break
                self.assertEqual(fake.invocations,0,'event-only application must not Arm on startup')
                process.send_signal(signal.SIGTERM)
                stdout,stderr=await asyncio.wait_for(process.communicate(),3)
                output.append(stdout);all_output=b''.join(output)
                self.assertEqual(process.returncode,0,stderr.decode())
                self.assertEqual(fake.stops,1);self.assertEqual(fake.invocations,0)
                self.assertIn(b'stop_confirmed',all_output)
                self.assertNotIn(b'unit-secret-token',all_output+stderr)
        finally:
            if process is not None and process.returncode is None:
                process.kill();await process.wait()
            await server.stop(0)

    async def test_real_stdin_event_replay_and_invalid_input_have_no_hidden_actions(self):
        for valid in (True,False):
            with self.subTest(valid=valid):
                catalog=json.loads(Path('/contracts/fixtures/rss-go2-catalog.v1.json').read_text())
                fake=test_bus.FakeControl(catalog);fake.descriptor.target_context.remote_arm_authorized=True
                fake.descriptor.host_clock_id=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
                server=grpc.aio.server();rpc.add_BusServicer_to_server(fake,server)
                port=server.add_insecure_port('127.0.0.1:0');await server.start();process=None
                try:
                    with tempfile.TemporaryDirectory() as folder:
                        root=Path(folder)/'app';root.mkdir();application(root)
                        target=Path(folder)/'target.json';target.write_text(json.dumps(TargetBinding.record(fake.descriptor).record_json()))
                        process=await asyncio.create_subprocess_exec(sys.executable,'-I','-m','rfrt','--root',str(root),
                            '--target',str(target),'--bus',f'127.0.0.1:{port}','--max-run-ms','5000','--events-stdin',
                            stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
                        while True:
                            line=await asyncio.wait_for(process.stdout.readline(),5)
                            self.assertTrue(line,'child exited before binding')
                            if b'"event": "bus_bound"' in line:break
                        event=dict(schema='rfevent.v1',id='unit-event',name='jump')
                        if not valid:event['unexpected']='rejected'
                        raw=(json.dumps(event)+'\n').encode()
                        process.stdin.write(raw+raw if valid else raw);await process.stdin.drain()
                        if valid:
                            end=asyncio.get_running_loop().time()+2
                            while fake.invocations<3 and asyncio.get_running_loop().time()<end:await asyncio.sleep(.01)
                            self.assertEqual(fake.invocations,3)
                            await asyncio.sleep(.05);self.assertEqual(fake.invocations,3,'same event ID must not replay')
                            process.send_signal(signal.SIGTERM)
                        stdout,stderr=await asyncio.wait_for(process.communicate(),3)
                        self.assertEqual(process.returncode,0 if valid else 3,stderr.decode())
                        self.assertEqual(fake.stops,1)
                        self.assertEqual(fake.invocations,3 if valid else 0)
                        self.assertNotIn(b'unit-secret-token',stdout+stderr)
                finally:
                    if process is not None and process.returncode is None:process.kill();await process.wait()
                    await server.stop(0)

    async def test_ros_navigation_scene_mismatch_fails_before_opening_any_bus(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)/'app';root.mkdir();application(root,'RW-B')
            catalog=json.loads(Path('/contracts/fixtures/rss-go2-catalog.v1.json').read_text())
            fake=test_bus.FakeControl(catalog);fake.descriptor.target_context.CopyFrom(pb.TargetContext(kind=pb.ROS_SIM,
                mapping_hash='sha256:'+'a'*64,adapter_source_hash='sha256:'+'b'*64,source_epoch='dog:unit',
                brain_boot_id='brain',scene_epoch='scene',config_hash='c'*64,scene_id='terrain_lab',map_generation='scene/map'))
            target=Path(folder)/'target.json';target.write_text(json.dumps(TargetBinding.record(fake.descriptor).record_json()))
            with self.assertRaisesRegex(ArtifactError,'navigation scene'):await execute(root,target,'unused:1')

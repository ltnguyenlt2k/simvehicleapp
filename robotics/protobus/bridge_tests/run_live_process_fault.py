"""Host-only bounded Docker fault injection; no socket is mounted into a service."""
import argparse
import json
from pathlib import Path
import subprocess
import threading
import time
import uuid


def run(service):
    root=Path(__file__).resolve().parents[2]
    compose=['docker','compose','-f',str(root/'protobus/bridge_tests/compose.live-test.yaml')]
    subprocess.run(['python3',str(Path(__file__).with_name('prepare_live_world.py'))],check=True)
    observer_name='sr-fault-observer-'+uuid.uuid4().hex[:12]
    command=['docker','compose','-f',str(root/'protobus/bridge_tests/compose.live-test.yaml'),
        'run','--rm','--no-deps','-T','--name',observer_name,'ros','python3','-m','bridge_tests.live_fault_hold']
    process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,text=True,bufsize=1)
    injected=False
    def expire():
        print('FAIL: actual process-fault observer exceeded 90 s',flush=True)
        try:
            subprocess.run(['docker','kill',observer_name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
        finally:
            if process.poll() is None: process.kill()
    timer=threading.Timer(90,expire)
    timer.start()
    try:
        for line in process.stdout:
            print(line,end='',flush=True)
            try: event=json.loads(line)
            except ValueError: continue
            if event.get('event')=='fault_ready':
                if service=='scene-epoch':
                    cutoff=time.monotonic_ns()
                    subprocess.run(['python3',str(Path(__file__).with_name('prepare_live_world.py'))],check=True)
                    injected=True
                    process.stdin.write(json.dumps({'cutoff_monotonic_ns':cutoff,'require_new_scene':True})+'\n')
                    process.stdin.flush()
                    continue
                target_service='ros' if service=='ros-network' else service
                target='sr-live-test-'+target_service+'-1'
                labels=json.loads(subprocess.check_output(['docker','inspect','--format','{{json .Config.Labels}}',target],text=True))
                assert labels.get('com.docker.compose.project')=='sr-live-test'
                assert labels.get('com.docker.compose.service')==target_service
                assert labels.get('com.docker.compose.oneoff')=='False'
                cutoff=time.monotonic_ns()
                # Compose kill by service also includes its one-off observer.
                # Kill only the verified long-running provider/broker container.
                if service=='ros-network':
                    subprocess.run(['docker','network','disconnect','dog-ros2-r1_robot',target],check=True)
                else:
                    subprocess.run(['docker','kill','-s','SIGKILL',target],check=True)
                injected=True
                process.stdin.write(json.dumps({'cutoff_monotonic_ns':cutoff})+'\n')
                process.stdin.flush()
        assert process.wait(timeout=15)==0,'actual fault observer failed'
        assert injected,'fault was not injected'
    finally:
        timer.cancel()
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)
        if service=='ros-network' and injected:
            subprocess.run(['docker','network','connect','dog-ros2-r1_robot','sr-live-test-ros-1'],check=True)
        restore=compose+['up','-d']
        if service=='ros-network': restore+=['--force-recreate']
        subprocess.run(restore+['ros' if service in ('ros-network','scene-epoch') else service],check=True)
        time.sleep(1)
        verify="import json,urllib.request; b=json.load(urllib.request.urlopen('http://localhost:8090/api/state'))['brain']; assert b['mode']=='SAFE_STOP' and b['authority']['owner'] is None and b['safe_command']==[0.,0.] and b['active_motion_id'] is None,b; print(json.dumps({'event':'restored_without_auto_arm','mode':b['mode']}))"
        subprocess.run(['docker','exec','dog-ros2-r1-gateway-1','python3','-c',verify],check=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('service',choices=('broker','ros','ros-network','scene-epoch'))
    run(parser.parse_args().service)

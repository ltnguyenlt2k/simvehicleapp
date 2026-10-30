"""Host-only bounded Docker fault injection; no socket is mounted into a service."""
import argparse
import json
from pathlib import Path
import subprocess
import time


def run(service):
    root=Path(__file__).resolve().parents[2]
    compose=['docker','compose','-f',str(root/'protobus/bridge_tests/compose.live-test.yaml')]
    subprocess.run(['python3',str(Path(__file__).with_name('prepare_live_world.py'))],check=True)
    command=['docker','compose','-f',str(root/'protobus/bridge_tests/compose.live-test.yaml'),
        'run','--rm','--no-deps','-T','ros','python3','-m','bridge_tests.live_fault_hold']
    process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,text=True,bufsize=1)
    injected=False
    try:
        for line in process.stdout:
            print(line,end='',flush=True)
            try: event=json.loads(line)
            except ValueError: continue
            if event.get('event')=='fault_ready':
                target='sr-live-test-'+service+'-1'
                labels=json.loads(subprocess.check_output(['docker','inspect','--format','{{json .Config.Labels}}',target],text=True))
                assert labels.get('com.docker.compose.project')=='sr-live-test'
                assert labels.get('com.docker.compose.service')==service
                assert labels.get('com.docker.compose.oneoff')=='False'
                cutoff=time.monotonic_ns()
                # Compose kill by service also includes its one-off observer.
                # Kill only the verified long-running provider/broker container.
                subprocess.run(['docker','kill','-s','SIGKILL',target],check=True)
                injected=True
                process.stdin.write(json.dumps({'cutoff_monotonic_ns':cutoff})+'\n')
                process.stdin.flush()
        assert process.wait(timeout=15)==0,'actual fault observer failed'
        assert injected,'fault was not injected'
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)
        subprocess.run(compose+['up','-d',service],check=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('service',choices=('broker','ros'))
    run(parser.parse_args().service)

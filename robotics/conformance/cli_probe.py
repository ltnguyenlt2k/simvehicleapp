"""Actual CLI qualification against the isolated kinematic SIM bus only."""
import json
from pathlib import Path
import signal
import subprocess
import time

ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'runtime/t08'
CLI=['python3',str(ROOT/'scripts/native_cli.py')]


def rejected(arguments):
    result=subprocess.run(CLI+arguments,capture_output=True,text=True,timeout=30)
    assert result.returncode==2,(arguments,result.returncode,result.stdout,result.stderr)


def main():
    rejected(['build',str(OUTPUT/'flows/RW-A.json'),'--out','t08-rwa','--authorize-sim-arm'])
    rejected(['build',str(OUTPUT/'flows/RW-A.json'),'--out','../escape'])
    assert not (ROOT/'runtime/escape').exists()
    rejected(['build',str(OUTPUT/'flows/RW-A.json'),'--out','t08-denied-arm'])
    assert not (ROOT/'runtime/apps/t08-denied-arm').exists()
    rejected(['target','--sim','--out','t08-mock'])
    rejected(['run','--sim','t08-rwc','--target','missing-target'])
    process=subprocess.Popen(CLI+['run','--sim','t08-rwc','--target','t08-mock','--events-stdin','--max-run-ms','30000'],
                             stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    events=[];sent=False;complete=False
    try:
        with (OUTPUT/'cli-native-rwc.log').open('w') as log:
            for line in process.stdout:
                log.write(line);log.flush()
                if not line.startswith('RFTRACE '):continue
                event=json.loads(line[8:]);events.append(event)
                if event['event']=='bus_bound' and not sent:
                    time.sleep(.1)
                    message=json.dumps({'schema':'rfevent.v1','id':'cli-jump','name':'jump'})+'\n'
                    process.stdin.write(message+message);process.stdin.flush();sent=True
                if event['event']=='log' and event['nodeId']=='complete_log':
                    complete=True;process.send_signal(signal.SIGTERM)
            code=process.wait(timeout=10)
        errors=process.stderr.read()
        assert code==0,(code,errors)
        assert complete and sent
        assert sum(e['event']=='node_started' and e['nodeId']=='jump' for e in events)==1
        assert any(e['event']=='stop_confirmed' for e in events)
        assert any(e['event']=='run_finished' and e['data']['phase']=='CANCELLED' for e in events)
        assert any(e['event']=='node_finished' and e['nodeId']=='jump' and e['data']['phase']=='SUCCEEDED' for e in events)
        print(json.dumps({'passed':True,'scope':'actual local CLI/mock; not ROS qualification',
                          'negativeCases':5,'duplicateEventStarts':1,'explicitStopConfirmed':True}))
    finally:
        if process.poll() is None:
            process.send_signal(signal.SIGTERM)
            process.wait(timeout=15)

if __name__=='__main__':main()

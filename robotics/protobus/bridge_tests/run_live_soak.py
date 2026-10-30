"""Host resource recorder for the real 30-minute live transport gate."""
import json
import argparse
from pathlib import Path
import re
import subprocess
import time
import uuid


NAMES=['sr-protobus-live-1','sr-protobus-ros2-1']+['dog-ros2-r1-'+name+'-1'
    for name in ('sim','brain','render','slam','perception','nav2','gateway')]


def rss(name):
    code="import json; print(json.dumps({line.split(':')[0]:int(line.split()[1])*1024 for line in open('/proc/1/status') if line.startswith(('VmRSS:','VmHWM:'))}))"
    return json.loads(subprocess.check_output(['docker','exec',name,'python3','-c',code],text=True,timeout=10))


def memory(value):
    amount,unit=re.fullmatch(r'([0-9.]+)([A-Za-z]+)',value.strip()).groups()
    return float(amount)*{'B':1,'kB':1000,'MB':1000**2,'GB':1000**3,
        'KiB':1024,'MiB':1024**2,'GiB':1024**3}[unit]


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--run-id',required=True)
    run_id=parser.parse_args().run_id
    if not re.fullmatch(r'run[0-9]+',run_id): raise ValueError('run-id must be run followed by digits')
    root=Path(__file__).resolve().parents[2]
    output=root/'runtime/m24/live-soak'/run_id
    output.mkdir(parents=True,exist_ok=True)
    assert not (output/'telemetry.jsonl').exists(),'preserve earlier result: use a new run directory'
    metadata=json.loads(subprocess.check_output(['docker','inspect']+NAMES,text=True))
    # Select safe metadata only; never write environment or credentials.
    safe_metadata=[dict(name=item['Name'],image_id=item['Image'],image=item['Config']['Image'],
        memory_limit=item['HostConfig']['Memory'],nano_cpus=item['HostConfig']['NanoCpus'],
        started_at=item['State']['StartedAt']) for item in metadata]
    (output/'metadata.json').write_text(json.dumps(dict(containers=safe_metadata,
        host_meminfo=Path('/proc/meminfo').read_text(),plan='docs/reports/M24-live-soak-plan.md'),indent=2))
    name='sr-live-soak-'+uuid.uuid4().hex[:10]
    samples=[]
    started=time.monotonic()
    process=None
    try:
        with (output/'telemetry.jsonl').open('w') as log,(output/'resources.jsonl').open('w') as resources:
            process=subprocess.Popen(['docker','run','--rm','--name',name,'--network','sr_live-bus',
                '--cpus','2','--memory','256m','--read-only','--tmpfs','/tmp',
                'sr-protobus:dev','python','-m','bridge_tests.live_soak'],stdout=log,stderr=subprocess.STDOUT)
            next_measure=started
            while process.poll() is None:
                now=time.monotonic()
                if now-started>1920: raise TimeoutError('live soak exceeded bounded 32-minute execution')
                if now>=next_measure:
                    stats=[json.loads(line) for line in subprocess.check_output(
                        ['docker','stats','--no-stream','--format','{{json .}}']+NAMES,text=True,timeout=20).splitlines()]
                    item=dict(elapsed_s=now-started,rss={key:rss(key) for key in NAMES[:2]},docker_stats=stats)
                    samples.append(item)
                    resources.write(json.dumps(item)+'\n'); resources.flush()
                    next_measure+=30
                    print(json.dumps({'event':'resource_sample','elapsed_s':item['elapsed_s'],
                        'rss_bytes':{key:value['VmRSS'] for key,value in item['rss'].items()}}),flush=True)
                time.sleep(1)
        assert process.returncode==0,'actual telemetry soak failed; see preserved telemetry.jsonl'
        last=json.loads((output/'telemetry.jsonl').read_text().splitlines()[-1])
        assert last.get('passed') is True and last['duration_s']>=1800,last
        warm=[item for item in samples if item['elapsed_s']>=120]
        assert len(warm)>=50,'insufficient sustained resource samples'
        results={}
        for service in NAMES[:2]:
            x=[item['elapsed_s']/60 for item in warm]
            y=[item['rss'][service]['VmRSS'] for item in warm]
            mean_x,mean_y=sum(x)/len(x),sum(y)/len(y)
            slope=sum((a-mean_x)*(b-mean_y) for a,b in zip(x,y))/sum((a-mean_x)**2 for a in x)
            growth=y[-1]-y[0]
            results[service]=dict(warm_rss_bytes=y[0],final_rss_bytes=y[-1],growth_bytes=growth,
                fitted_growth_bytes_per_minute=slope,peak_rss_bytes=max(y))
            assert growth<=16*1024**2 and slope<=.5*1024**2,(service,results[service])
        peak=max(sum(memory(stat['MemUsage'].split('/')[0]) for stat in item['docker_stats']) for item in samples)
        result=dict(passed=True,duration_s=time.monotonic()-started,python_rss=results,
            peak_summed_docker_reported_memory_bytes=peak,summed_container_caps_bytes=sum(item['memory_limit'] for item in safe_metadata),
            telemetry=last,scope='M24 actual live transport only; not workflow/hardware')
        (output/'result.json').write_text(json.dumps(result,indent=2))
        print(json.dumps(result),flush=True)
    finally:
        if process is not None and process.poll() is None:
            subprocess.run(['docker','kill',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
            process.wait(timeout=10)


if __name__=='__main__': main()

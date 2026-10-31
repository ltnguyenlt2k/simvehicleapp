"""Actual ROS deployment-binding refusal before workflow body or lease admission."""
import json,subprocess,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUTPUT=ROOT/'runtime/t08'
with urllib.request.urlopen('http://127.0.0.1:8092/api/state',timeout=3) as response:before=json.load(response)
assert before['brain']['authority']['owner'] is None
info=json.loads(subprocess.check_output(['docker','run','--rm','--network','none','sr-rfrt:dev','python','-I','-m','rfrt','--runtime-info'],text=True))
app='t08-rwa-'+info['packageHash'].split(':')[1][:10]
target=next(path for path in sorted((ROOT/'runtime/targets').glob('live-*.json'))
 if json.loads(path.read_text())['context'].get('sceneEpoch')!=before['brain']['scene_epoch'])
result=subprocess.run(['python3',str(ROOT/'scripts/native_cli.py'),'run','--live',app,'--target',target.stem],capture_output=True,text=True,timeout=20)
(OUTPUT/'native-stale-target.log').write_text(result.stdout+result.stderr)
assert result.returncode==2,(result.returncode,result.stdout,result.stderr)
events=[json.loads(line[8:]) for line in result.stdout.splitlines() if line.startswith('RFTRACE ')]
assert not any(e['event'] in ('bus_bound','node_started') for e in events)
with urllib.request.urlopen('http://127.0.0.1:8092/api/state',timeout=3) as response:after=json.load(response)
assert after['brain']['authority']['owner'] is None
assert after['brain']['mode']==before['brain']['mode'] and after['brain']['active_motion_id'] is None
print(json.dumps(dict(passed=True,scope='actual ROS target mismatch; no body admitted',target=target.stem,returnCode=result.returncode)))

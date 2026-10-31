"""Sequential 12-case acceptance matrix, repeated twice; isolated mock only."""
import fcntl,json,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUTPUT=ROOT/'robotics/runtime/m25/conformance'
OUTPUT.mkdir(parents=True,exist_ok=True)
(OUTPUT/'gate-summary.json').unlink(missing_ok=True)
lock=(OUTPUT/'gate.lock').open('w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
compose=['docker','compose','-f',str(ROOT/'robotics/conformance/compose.yaml')]
def run(args,path):
 with path.open('w') as log:
  result=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT)
 if result.returncode:raise RuntimeError((args,result.returncode,str(path)))
subprocess.run(['python3',str(ROOT/'robotics/conformance/run.py')],check=True)
cases=['condition','policy-drop','policy-queue','policy-restart','hold','result-FAILED','result-REJECTED','result-TIMED_OUT','parallel-cancel','parallel-stop','parallel-all','parallel-any','sigterm','RW-C','event-invalid','typed-patrol','binding-mismatch']
images={name:subprocess.check_output(['docker','image','inspect',name,'--format','{{.Id}}'],text=True).strip() for name in ('sr-rfrt:dev','sr-robotflow:dev','sr-protobus:dev')}
(OUTPUT/'gate-images.json').write_text(json.dumps(images,indent=2)+'\n')
summary=[]
try:
 for repetition in (1,2):
  started=time.monotonic()
  run(compose+['up','-d','--force-recreate','--wait','--wait-timeout','60','broker','mock'],OUTPUT/f'gate-{repetition}-startup.log')
  run(compose+['--profile','tools','run','--rm','--no-deps','runner','python','/probe/probe.py',*cases],OUTPUT/f'gate-{repetition}-cases.log')
  run(compose+['--profile','tools','run','--rm','--no-deps','runner','python','/probe/fault_probe.py','lease'],OUTPUT/f'gate-{repetition}-lease.log')
  run(['python3',str(ROOT/'robotics/conformance/fault_host.py'),f'gate-{repetition}'],OUTPUT/f'gate-{repetition}-provider-host.log')
  summary.append(dict(repetition=repetition,result='PASS',cases=12,subcases=len(cases)+2,seconds=time.monotonic()-started))
  print(json.dumps(summary[-1]),flush=True)
 (OUTPUT/'gate-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
finally:
 subprocess.run(compose+['down'],check=False)

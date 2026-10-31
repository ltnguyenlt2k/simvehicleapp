"""Host-only actions against the real local SIM; no Docker socket in observers."""
import json,subprocess,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUTPUT=ROOT/'runtime/t08';OUTPUT.mkdir(parents=True,exist_ok=True)
compose=['docker','compose','-f',str(Path(__file__).with_name('compose.t08-test.yaml'))]
def pause(value):
 request=urllib.request.Request('http://127.0.0.1:8092/api/sim',data=json.dumps({'action':'pause','value':value}).encode(),headers={'Content-Type':'application/json'})
 reply=json.load(urllib.request.urlopen(request,timeout=5));assert reply['accepted'],reply
for case in ('pause','perception','epoch'):
 process=subprocess.Popen(compose+['--profile','tools','run','--rm','--no-deps','observer','python3','-m','bridge_tests.live_capture_faults','--case',case],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 active=False;completed=False
 try:
  with (OUTPUT/('capture-'+case+'.log')).open('w') as log:
   for line in process.stdout:
    log.write(line);log.flush()
    if not line.startswith('{'):continue
    data=json.loads(line)
    if data.get('passed') is True:completed=True
    if data.get('event')=='CAPTURE_TEST_READY':
     if case=='pause':pause(True);active=True
     elif case=='perception':subprocess.run(['docker','pause','dog-ros2-r1-perception-1'],check=True);active=True
     else:subprocess.run(['python3',str(Path(__file__).with_name('prepare_live_world.py'))],check=True)
    elif data.get('event')=='CAPTURE_FAULT_OBSERVED':
     if case=='pause':pause(False);active=False
     elif case=='perception':subprocess.run(['docker','unpause','dog-ros2-r1-perception-1'],check=True);active=False
   code=process.wait(timeout=10)
   if code or not completed:raise RuntimeError((case,code,completed))
  print('Actual capture fault',case,'PASS',flush=True)
 finally:
  if active:
   if case=='pause':pause(False)
   elif case=='perception':subprocess.run(['docker','unpause','dog-ros2-r1-perception-1'],check=False)
  if process.poll() is None:process.terminate();process.wait(timeout=10)

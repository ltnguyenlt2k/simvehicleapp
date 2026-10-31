"""Host controls only this isolated fixture; runner has no Docker access."""
from pathlib import Path
import subprocess,sys
ROOT=Path(__file__).resolve().parents[2]
compose=['docker','compose','-f',str(ROOT/'robotics/conformance/compose.yaml')]
output=ROOT/'robotics/runtime/m25/conformance'/('provider-'+(sys.argv[1] if len(sys.argv)>1 else '1')+'.log')
process=subprocess.Popen(compose+['--profile','tools','run','--rm','--no-deps','runner','python','/probe/fault_probe.py','provider'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
injected=False
with output.open('w') as log:
 try:
  for line in process.stdout:
   log.write(line);log.flush()
   if line.strip()=='FAULT_READY':
    injected=True
    subprocess.run(compose+['kill','--signal','SIGKILL','mock'],check=True,timeout=10)
    subprocess.run(compose+['start','mock'],check=True,timeout=10)
  code=process.wait(timeout=20)
  if code or not injected:raise RuntimeError(('provider-fault',code,injected))
 finally:
  if process.poll() is None:process.terminate();process.wait(timeout=10)
print('Actual provider restart/native application PASS')

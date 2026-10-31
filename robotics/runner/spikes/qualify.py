"""Host fixture preparation and bounded cleanup; no Docker socket in runner."""
import json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUTPUT=ROOT/'runtime/m26';OUTPUT.mkdir(parents=True,exist_ok=True)
compose=['docker','compose','-f',str(Path(__file__).with_name('compose.yaml'))]
def capture(args):return subprocess.check_output(args,text=True)
info=json.loads(capture(['docker','run','--rm','--network','none','sr-rfrt:dev','python','-I','-m','rfrt','--runtime-info']))
files=json.loads(capture(['docker','run','--rm','--network','none','-v',str(Path(__file__).parent)+':/probe:ro','sr-robotflow:dev','python','/probe/compile_hold.py',info['packageHash']]))
for relative,content in files.items():
 target=OUTPUT/'runner-apps/hold'/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(content)
wire=capture(['docker','run','--rm','--network','none','sr-protobus:dev','python','-c','import base64;from protobus.mock.v1 import mock_pb2 as m;print(base64.b64encode(m.DESCRIPTOR.serialized_pb).decode())'])
(OUTPUT/'runner-apps/mock-descriptor.b64').write_text(wire.strip())
try:
 subprocess.run(compose+['up','-d','--wait','--wait-timeout','40','broker','mock','guard-api','opposite'],check=True,timeout=60)
 subprocess.run(compose+['--profile','tools','run','--rm','--no-deps','front-probe'],check=True,timeout=15)
 subprocess.run(compose+['--profile','tools','run','--rm','--no-deps','runner'],check=True,timeout=60)
finally:
 subprocess.run(compose+['down'],check=False,timeout=30)

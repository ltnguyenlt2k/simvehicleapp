"""Host-only fixture orchestration. No Docker socket or source writes in runners."""
import json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUTPUT=ROOT/'robotics/runtime/m25/conformance'
OUTPUT.mkdir(parents=True,exist_ok=True)
def command(args):
 result=subprocess.run(args,text=True,capture_output=True)
 if result.returncode:
  (OUTPUT/'compile-failure.log').write_text(result.stderr)
  raise RuntimeError(result.stderr)
 return result.stdout
info=json.loads(command(['docker','run','--rm','--network','none','sr-rfrt:dev','python','-I','-m','rfrt','--runtime-info']))
files=command(['docker','run','--rm','--network','none','--read-only','--tmpfs','/tmp','--cpus','2','--memory','256m','-v',str(ROOT/'robotics/conformance')+':/probe:ro','sr-robotflow:dev','python','/probe/compile_cases.py',info['packageHash']])
for name,app in json.loads(files).items():
 for path,content in app.items():
  target=OUTPUT/'apps'/name/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(content)
print('Compiled',len(json.loads(files)),'actual pinned native fixtures')

# Generated wire descriptor only; provider implementation is not imported by runtime.
wire=command(['docker','run','--rm','--network','none','sr-protobus:dev','python','-c',
 'import base64;from protobus.mock.v1 import mock_pb2 as m;print(base64.b64encode(m.DESCRIPTOR.serialized_pb).decode())'])
(OUTPUT/'apps/mock-descriptor.b64').write_text(wire.strip())

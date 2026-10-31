import json,sys
from pathlib import Path
from templates import Graph
from registry import load_registry
from codegen import build_application

g=Graph(load_registry());start=g.add('start','on_start');failure=g.cleanup('failure')
hold=g.add('hold','move',{'linear':'0.2 m/s','angular':'0 rad/s','durationMs':10000})
done=g.complete('complete',failure,'bounded-hold-complete')
g.setup(start,hold,failure);g.results(hold,done,failure)
profile=json.loads(Path('profiles/dog-go2-sim.json').read_text());profile['allowRemoteArm']=True
catalog=json.loads(Path('/contracts/fixtures/rss-go2-catalog.v1.json').read_text())
result=build_application(g.value(),catalog,profile,runtime_package_hash=sys.argv[1])
assert result['ok'],result['diagnostics']
print(json.dumps(result['files']))

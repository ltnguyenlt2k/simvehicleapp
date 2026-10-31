"""Test-only native compiler export, run in compiler image; no runtime import."""
import json
from pathlib import Path
import sys
from codegen import build_application
from templates import templates,Graph
from registry import load_registry

catalog=json.loads(Path('/contracts/fixtures/rss-go2-catalog.v1.json').read_text())
profile=json.loads(Path('/opt/robotflow/profiles/dog-go2-sim.json').read_text())
profile['allowRemoteArm']=True
cases=templates()
cases['event-invalid']=templates()['RW-C']
cases['binding-mismatch']=templates()['RW-C']
g=Graph(load_registry());trigger=g.add('start','on_start');failure=g.cleanup('failure')
move=g.add('move','move',{'linear':'0.2 m/s','angular':'0 rad/s','durationMs':400})
bow=g.add('bow','perform',{'name':'BOW'});done=g.complete('complete',failure,'hold-then-bow-complete')
g.setup(trigger,move,failure);g.results(move,bow,failure);g.results(bow,done,failure)
cases['hold']=g.value()

# Read-only trigger cases isolate activation semantics from body ownership.
for policy in ('drop','queue','restart'):
 g=Graph(load_registry());t=g.add('event','on_event',{'name':'pulse','concurrency':policy,'queueMax':1})
 wait=g.add('delay','wait',{'durationMs':300});log=g.add('observed','log',{'message':'activation-complete','level':'info'});end=g.add('end','end')
 g.link(t,'next',wait);g.link(wait,'next',log);g.link(log,'next',end)
 cases['policy-'+policy]=g.value()
g=Graph(load_registry());t=g.add('condition','on_condition',{'when':'Robot.Perception.Marker.Count > 0','forMs':100})
log=g.add('observed','log',{'message':'condition-complete','level':'info'});end=g.add('end','end')
g.link(t,'next',log);g.link(log,'next',end);cases['condition']=g.value()
for mode in ('all','any','cancel','stop'):
 g=Graph(load_registry());t=g.add('start','on_start');failure=g.cleanup('failure')
 parallel=g.add('parallel','parallel',{'mode':'any' if mode=='any' else 'all'})
 body=g.add('body','move',{'durationMs':1000,'linear':'0.2 m/s','angular':'0 rad/s'}) if mode in ('all','any','stop') else g.add('body','perform',{'name':'BOW'})
 body_end=g.add('body_end','join' if mode=='cancel' else 'end');
 if mode=='cancel':g.link(body_end,'next',g.add('body_finished','end'))
 other=g.add('other_wait','wait',{'durationMs':150});other_end=g.add('other_end','end')
 done=g.complete('complete',failure,'parallel-complete')
 g.setup(t,parallel,failure);g.link(parallel,'branch1',body);g.link(parallel,'branch2',other);g.link(parallel,'done',done)
 body_failure=g.cleanup('body_failure')
 g.results(body,body_end,body_failure)
 if mode=='cancel':
  for edge in g.edges:
   if edge['from']==[body,'cancelled']:edge['to']=[body_end,'in']
 if mode in ('cancel','stop'):
  other_failure=g.cleanup('other_failure')
  action=g.add('action',mode);g.link(other,'next',action)
  g.results(action,other_end,other_failure)
 else:g.link(other,'next',other_end)
 cases['parallel-'+mode]=g.value()

for phase in ('FAILED','REJECTED','TIMED_OUT'):
 g=Graph(load_registry());t=g.add('start','on_start');failure=g.cleanup('failure')
 body=g.add('body','perform',{'name':'BOW','timeoutMs':500 if phase=='TIMED_OUT' else 15000})
 g.setup(t,body,failure)
 for outcome in ('succeeded','failed','rejected','cancelled','timed_out'):
  log=g.add(outcome+'_log','log',{'message':'observed-'+outcome,'level':'info'})
  end=g.add(outcome+'_end','end');g.link(body,outcome,log);g.link(log,'next',end)
 cases['result-'+phase]=g.value()
signal_case=templates()['RW-C']
# Explicit start + long Move allows SIGTERM while an admitted body is active.
g=Graph(load_registry());t=g.add('start','on_start');failure=g.cleanup('failure')
move=g.add('move','move',{'durationMs':2000,'linear':'0.2 m/s','angular':'0 rad/s'})
bow=g.add('bow','perform',{'name':'BOW'});done=g.complete('complete',failure,'long-move-complete')
g.setup(t,move,failure);g.results(move,bow,failure);g.results(bow,done,failure)
cases['sigterm']=g.value();cases['lease-loss']=g.value()

patrol=templates()['RW-B']
patrol['vars']={'distance':{'type':'float64','unit':'m','initial':.2}}
for item in patrol['nodes']:
 if item['id']=='patrol':item['props']['waypoints']=[[.1,0.],[.1,.1],[0.,.1]]
patrol['nodes'] += [dict(id='distance_assign',block='rf.assign',v=1,props={'name':'distance','value':'distance + 10 cm'}),dict(id='distance_log',block='rf.log',v=1,props={'message':'distance={distance}','level':'info'})]
for edge in patrol['edges']:
 if edge['from']==['patrol_loop','body']:edge['to']=['distance_assign','in']
 if edge['from']==['patrol','succeeded']:edge['to']=['distance_log','in']
patrol['edges'] += [{'from':['distance_assign','next'],'to':['patrol','in']},{'from':['distance_log','next'],'to':['patrol_end','in']}]
cases['typed-patrol']=patrol
result={}
for name,source in cases.items():
 built=build_application(source,catalog,profile,runtime_package_hash=sys.argv[1])
 if not built['ok']:raise RuntimeError((name,built['diagnostics']))
 result[name]=built['files']
print(json.dumps(result,ensure_ascii=False))

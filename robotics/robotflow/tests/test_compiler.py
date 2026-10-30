import copy
import hashlib
import json
from pathlib import Path
import time
import tempfile
import unittest

from compiler import compile_workflow
from registry import load_registry
from units import UnitRegistry

ROOT=Path(__file__).resolve().parents[1]
CATALOG=json.loads(Path('/contracts/fixtures/rss-go2-catalog.v1.json').read_text())
PROFILE=json.loads((ROOT/'profiles/dog-go2-sim.json').read_text())


def node(identity,block,props=None):return dict(id=identity,block='rf.'+block,v=1,props=props or {},ui={'x':0,'y':0})
def edge(source,port,target):return {'from':[source,port],'to':[target,'in']}
def graph(nodes=None,edges=None,variables=None):
    return dict(schema='robotflow.v1',rss={'version':'0.1','catalogHash':CATALOG['catalogHash']},
        profile=PROFILE['id'],vars=variables or {},nodes=nodes or [node('s','on_start'),node('l','log')],
        edges=edges if edges is not None else [edge('s','next','l')])


def single(block,props=None,variables=None):
    registry=load_registry()
    ports=registry.get('rf.'+block)['ports']['outputs']
    return graph([node('s','on_start'),node('op',block,props),node('j','join'),node('e','end')],
        [edge('s','next','op')]+[edge('op',port,'j') for port in ports]+[edge('j','next','e')],variables)


def control():
    nodes=[node('s','on_start'),node('arm','arm'),node('move','move'),node('disarm','disarm'),
        node('cleanup','join'),node('stop','stop'),node('stopped','join'),node('ok','end'),node('failed','end')]
    edges=[edge('s','next','arm'),edge('arm','succeeded','move'),edge('move','succeeded','disarm'),
        edge('disarm','succeeded','ok'),edge('cleanup','next','stop'),edge('stopped','next','failed')]
    for identity in ('arm','move','disarm'):
        edges.extend(edge(identity,phase,'cleanup') for phase in ('failed','rejected','cancelled','timed_out'))
    edges.extend(edge('stop',phase,'stopped') for phase in ('succeeded','failed','rejected','cancelled','timed_out'))
    return graph(nodes,edges)


def allowed():
    result=copy.deepcopy(PROFILE);result['allowRemoteArm']=True;return result


class CompilerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.registry=load_registry()

    def compile(self,value,profile=None,mode='build'):
        return compile_workflow(value,CATALOG,profile or allowed(),self.registry,mode=mode)

    def codes(self,result):return {item['code'] for item in result['diagnostics']}

    def test_valid_control_is_typed_hashed_and_deterministic_excluding_ui_and_input_order(self):
        original=control();result=self.compile(original)
        self.assertTrue(result['ok'],result['diagnostics'])
        self.assertIsNotNone(result['ir'])
        alternate=copy.deepcopy(original);alternate['nodes'].reverse();alternate['edges'].reverse()
        for item in alternate['nodes']:item['ui']={'x':789,'y':-432}
        self.assertEqual(result['ir'],self.compile(alternate)['ir'])
        ir=copy.deepcopy(result['ir']);digest=ir.pop('irHash')
        expected='sha256:'+hashlib.sha256(json.dumps(ir,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()).hexdigest()
        self.assertEqual(digest,expected)
        self.assertIn('unitsHash',ir)
        self.assertEqual(result['ir'],self.compile(original)['ir'])

    def test_one_deliberate_fixture_for_every_registered_rf_code(self):
        cases={}
        value=graph();value['extra']=True;cases['RF1001']=(value,allowed())
        value=graph();value['nodes'][1]['props']['message']='x'*(1024*1024);cases['RF1002']=(value,allowed())
        value=graph();value['nodes'].append(copy.deepcopy(value['nodes'][1]));cases['RF1003']=(value,allowed())
        value=graph();value['edges'][0]['to'][0]='missing';cases['RF1004']=(value,allowed())
        value=graph();value['edges'][0]['from'][1]='missing';cases['RF1005']=(value,allowed())
        value=graph();value['edges'].append(copy.deepcopy(value['edges'][0]));cases['RF1006']=(value,allowed())
        value=graph([node('s','on_start'),node('j','join'),node('w','wait')],
            [edge('s','next','j'),edge('j','next','w'),edge('w','next','j')]);cases['RF1007']=(value,allowed())
        value=graph();value['nodes'][1]['block']='rf.unknown';cases['RF2001']=(value,allowed())
        value=graph();value['nodes'][1]['v']=2;cases['RF2002']=(value,allowed())
        value=graph();value['nodes'][1]['props']={'unknown':1};cases['RF2003']=(value,allowed())
        value=graph();value['rss']['catalogHash']='sha256:'+'0'*64;cases['RF3001']=(value,allowed())
        vars={'x':{'type':'float64','initial':0}}
        cases['RF3002']=(single('read',{'path':'Robot.Unknown','name':'x'},vars),allowed())
        cases['RF3003']=(single('read',{'path':'Robot.Safety.Arm','name':'x'},vars),allowed())
        vars={'count':{'type':'int32','initial':0}}
        for code,expression in [('RF4001','1 +'),('RF4002','true'),('RF4004','missing + 1'),('RF4005','1 / 0')]:
            cases[code]=(single('assign',{'name':'count','value':expression},vars),allowed())
        value=control();value['nodes'][2]['props']['linear']='1 s';cases['RF4003']=(value,allowed())
        value=graph();value['nodes'].append(node('orphan','log'));cases['RF5001']=(value,allowed())
        value=control();value['edges']=[item for item in value['edges'] if item['from']!=['arm','failed']];cases['RF5002']=(value,allowed())
        value=graph([node('s','on_start'),node('loop','loop'),node('j','join'),node('e','end')],
            [edge('s','next','loop'),edge('loop','body','j'),edge('loop','done','j'),edge('j','next','e')]);cases['RF5003']=(value,allowed())
        value=graph([node('s','on_start'),node('loop','loop',{'forever':True}),node('l','log'),node('e','end')],
            [edge('s','next','loop'),edge('loop','body','l'),edge('loop','done','e')]);cases['RF5004']=(value,allowed())
        value=graph([node('s','on_start'),node('p','parallel'),node('a','assign',{'name':'count','value':'1'}),
            node('b','assign',{'name':'count','value':'2'}),node('ea','end'),node('eb','end'),node('done','end')],
            [edge('s','next','p'),edge('p','branch1','a'),edge('p','branch2','b'),edge('p','done','done'),edge('a','next','ea'),edge('b','next','eb')],vars)
        cases['RF5005']=(value,allowed())
        value=control();value['nodes'][2]['props']['linear']='1 m/s';cases['RF6001']=(value,allowed())
        value=control();profile=allowed();profile['limits']['maxMoveMs']=100;cases['RF6002']=(value,profile)
        cases['RF6003']=(control(),PROFILE)
        cases['RF6004']=(single('arm'),allowed())
        value=control();value['nodes'][2]['props']['timeoutMs']=400;cases['RF6005']=(value,allowed())
        value=graph([node('s','on_start'),node('p','parallel'),node('a','move'),node('b','move'),
            node('ja','join'),node('jb','join'),node('ea','end'),node('eb','end'),node('done','end')],
            [edge('s','next','p'),edge('p','branch1','a'),edge('p','branch2','b'),edge('p','done','done'),edge('ja','next','ea'),edge('jb','next','eb')]
            +[edge(identity,phase,join) for identity,join in (('a','ja'),('b','jb')) for phase in ('succeeded','failed','rejected','cancelled','timed_out')])
        cases['RF6006']=(value,allowed())
        profile=allowed();profile['limits']['maxPatrolPoints']=3;cases['RF6007']=(single('patrol'),profile)
        cases['RF6008']=(single('go_to',{'x':'1000 m'}),allowed())
        catalog=json.loads(Path('/contracts/diagnostics.v1.json').read_text())
        expected={code for code in catalog['codes'] if code.startswith('RF')}
        self.assertEqual(set(cases),expected)
        for code,(value,profile) in cases.items():
            with self.subTest(code=code):
                result=self.compile(value,profile)
                self.assertIn(code,self.codes(result),result['diagnostics'])
                if code!='RF6004':self.assertFalse(result['ok']);self.assertIsNone(result['ir'])
                for diagnostic in result['diagnostics']:
                    self.assertEqual(diagnostic['severity'],catalog['details'][diagnostic['code']]['severity'])
                    self.assertIn('vi',diagnostic['message'])

    def test_malformed_serialized_input_duplicate_keys_nonfinite_and_depth_are_closed(self):
        for text in ('{"schema":"robotflow.v1","schema":"robotflow.v1"}','{"bad":NaN}','['*100+'0'+']'*100):
            with self.subTest(text=text):
                result=self.compile(text)
                self.assertFalse(result['ok']);self.assertIsNone(result['ir'])

    def test_bounded_dynamic_speed_and_lint_mode(self):
        value=control();value['nodes'][2]['props']['linear']='clamp(Robot.Velocity.Linear.X,-0.2 m/s,0.2 m/s)'
        result=self.compile(value)
        self.assertTrue(result['ok'],result['diagnostics'])
        lint=self.compile(value,mode='lint')
        self.assertTrue(lint['ok']);self.assertIsNone(lint['ir'])

    def test_all_24_registry_blocks_have_successful_lowering_fixtures(self):
        covered=set()
        for block in ('on_start','on_change','on_condition','every','on_event'):
            value=graph();value['nodes'][0]['block']='rf.'+block
            result=self.compile(value)
            self.assertTrue(result['ok'],(block,result['diagnostics']));covered.add('rf.'+block)
        variables={'count':{'type':'int32','initial':0},'battery':{'type':'float64','unit':'%','initial':0}}
        for block in ('arm','disarm','reset_stop','stop','move','go_to','patrol','perform','cancel','if','wait','wait_until','assign','read','log','join'):
            props={'message':'row {count} {{literal}}'} if block=='log' else None
            result=self.compile(single(block,props,variables))
            self.assertTrue(result['ok'],(block,result['diagnostics']));covered.add('rf.'+block)
        result=self.compile(graph([node('s','on_start'),node('e','end')],[edge('s','next','e')]))
        self.assertTrue(result['ok'],result['diagnostics']);covered.add('rf.end')
        for forever in (False,True):
            value=graph([node('s','on_start'),node('loop','loop',{'forever':forever}),node('w','wait'),node('body_end','end'),node('done','end')],
                [edge('s','next','loop'),edge('loop','body','w'),edge('w','next','body_end'),edge('loop','done','done')])
            result=self.compile(value);self.assertTrue(result['ok'],result['diagnostics']);covered.add('rf.loop')
        for mode in ('all','any'):
            value=graph([node('s','on_start'),node('p','parallel',{'mode':mode}),node('a','wait'),node('b','wait'),
                node('ea','end'),node('eb','end'),node('done','end')],
                [edge('s','next','p'),edge('p','branch1','a'),edge('p','branch2','b'),edge('a','next','ea'),edge('b','next','eb'),edge('p','done','done')])
            result=self.compile(value);self.assertTrue(result['ok'],result['diagnostics']);covered.add('rf.parallel')
        self.assertEqual(covered,{item['id'] for item in self.registry.records})

    def test_immediately_true_wait_until_is_not_a_forever_yield_guarantee(self):
        value=graph([node('s','on_start'),node('loop','loop',{'forever':True}),node('w','wait_until',{'when':'true'}),
            node('j','join'),node('body_end','end'),node('done','end')],
            [edge('s','next','loop'),edge('loop','body','w'),edge('w','succeeded','j'),edge('w','timed_out','j'),
             edge('j','next','body_end'),edge('loop','done','done')])
        self.assertIn('RF5004',self.codes(self.compile(value)))

    def test_policy_cannot_be_granted_by_graph_and_real_backend_is_forbidden(self):
        value=control();value['vars']['allowRemoteArm']={'type':'bool','initial':True}
        self.assertIn('RF6003',self.codes(self.compile(value,PROFILE)))
        value=control();value['allowRemoteArm']=True
        self.assertIn('RF1001',self.codes(self.compile(value)))
        for change in ({'backend':'REAL'},{'callbackUrl':'http://untrusted/'},{'allowRemoteArm':'true'}):
            profile=allowed();profile.update(change)
            self.assertIn('RF6003',self.codes(self.compile(control(),profile)))

    def test_unit_and_policy_identity_are_bound_even_without_literal_unit_use(self):
        original=self.compile(graph())['ir']
        profile=allowed();profile['limits']['maxRunMs']-=1
        changed=self.compile(graph(),profile)['ir']
        self.assertNotEqual(original['profileHash'],changed['profileHash'])
        self.assertNotEqual(original['irHash'],changed['irHash'])
        data=json.loads(Path('/contracts/units.v1.json').read_text());data['units']['cm']['scale']=.02
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'units.json';path.write_text(json.dumps(data))
            result=compile_workflow(graph(),CATALOG,allowed(),self.registry,units=UnitRegistry(path))
        self.assertTrue(result['ok'],result['diagnostics'])
        self.assertNotEqual(original['unitsHash'],result['ir']['unitsHash'])
        self.assertNotEqual(original['irHash'],result['ir']['irHash'])

    def test_long_loop_body_yield_analysis_does_not_depend_on_python_recursion(self):
        nodes=[node('s','on_start'),node('loop','loop',{'forever':True})]
        nodes += [node('l'+str(index),'log') for index in range(200)]
        nodes += [node('w','wait'),node('body_end','end'),node('done','end')]
        edges=[edge('s','next','loop'),edge('loop','body','l0'),edge('loop','done','done')]
        edges += [edge('l'+str(index),'next','l'+str(index+1)) for index in range(199)]
        edges += [edge('l199','next','w'),edge('w','next','body_end')]
        result=self.compile(graph(nodes,edges))
        self.assertTrue(result['ok'],result['diagnostics'])

    def test_shared_continuation_expansion_is_bounded_before_large_json_allocation(self):
        nodes=[node('s','on_start')]
        edges=[];previous='s'
        for index in range(10):
            identity='a'+str(index);join='j'+str(index)
            nodes.extend([node(identity,'arm'),node(join,'join')]);edges.append(edge(previous,'next',identity))
            edges.extend(edge(identity,phase,join) for phase in ('succeeded','failed','rejected','cancelled','timed_out'))
            previous=join
        nodes.append(node('tail','log',{'message':'x'*16000}));edges.append(edge(previous,'next','tail'))
        started=time.perf_counter();result=self.compile(graph(nodes,edges));elapsed=time.perf_counter()-started
        self.assertFalse(result['ok']);self.assertIn('RF1002',self.codes(result));self.assertLess(elapsed,2)

    def test_lint_200_nodes_below_300_milliseconds(self):
        nodes=[node('s','on_start')]+[node('l'+str(index),'log',{'message':'row'}) for index in range(199)]
        edges=[edge(nodes[index]['id'],'next',nodes[index+1]['id']) for index in range(199)]
        value=graph(nodes,edges)
        start=time.perf_counter();result=self.compile(value,mode='lint');elapsed=(time.perf_counter()-start)*1000
        self.assertTrue(result['ok'],result['diagnostics'])
        self.assertLess(elapsed,300)
        print(f'RobotFlow 200-node lint: {elapsed:.3f} ms',flush=True)

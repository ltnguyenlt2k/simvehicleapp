"""Closed RobotFlow wire contracts; no ROS, runtime or vehicle imports."""
import json
import importlib.util
from pathlib import Path
import unittest
from jsonschema import Draft202012Validator

HASH='sha256:'+'a'*64


def workflow():
    return dict(schema='robotflow.v1',rss=dict(version='0.1',catalogHash=HASH),profile='dog-go2-sim',
        vars={'count':{'type':'int32','initial':0}},
        nodes=[dict(id='start',block='rf.on_start',v=1,props={},ui=dict(x=0,y=0)),
               dict(id='log',block='rf.log',v=1,props={'message':'Hello'})],
        edges=[{'from':['start','next'],'to':['log','in']}])


def block():
    return dict(schema='block.v1',id='rf.log',version=1,category='log',
        title={'vi':'Ghi log','en':'Log'},
        ports={'inputs':{'in':{'required':True,'role':'in'}},
               'outputs':{'next':{'required':False,'role':'next'}}},
        props={'message':{'type':'string','required':True,'default':'Hello'}},
        semantics={'vi':'Ghi một bản tin.','en':'Write one message.'},lowering='log',migrations=[])


def ir():
    return dict(schema='rfir.v1',catalogHash=HASH,profile='dog-go2-sim',profileHash=HASH,
        runtimeVersion='0.1.0',unitsHash=HASH,irHash=HASH,vars={},behaviors=[dict(id='start',src={'nodeId':'start'},
        trigger={'kind':'start'},concurrency='drop',queueMax=1,
        body=[{'op':'log','src':{'nodeId':'log'},'level':'info','parts':['Hello']}])])


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.schemas={name:json.loads((Path('/contracts')/(name+'.json')).read_text())
                      for name in ('robotflow.v1','rfir.v1','block.v1')}
        self.validators={name:Draft202012Validator(schema) for name,schema in self.schemas.items()}

    def test_all_schemas_and_valid_fixtures(self):
        for name,fixture in [('robotflow.v1',workflow()),('block.v1',block()),('rfir.v1',ir())]:
            with self.subTest(name=name):
                Draft202012Validator.check_schema(self.schemas[name])
                self.validators[name].validate(fixture)

    def test_checked_in_schemas_match_deterministic_contract_source(self):
        spec=importlib.util.spec_from_file_location('schema_source','/contracts/robotflow_contracts.py')
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for name,schema in module.schemas().items():
            expected=json.dumps(schema,sort_keys=True,indent=2,ensure_ascii=False)+'\n'
            self.assertEqual((Path('/contracts')/(name+'.json')).read_text(),expected)

    def test_workflow_rejects_open_objects_wrong_identity_and_executable_payload(self):
        variants=[]
        for changes in ({'schema':'robotflow.v2'},{'profile':'../runtime'},{'shell':'rm -rf /'},
                        {'rss':{'version':'0.1','catalogHash':'unpinned'}},{'nodes':[]}):
            variants.append(dict(workflow(),**changes))
        item=workflow(); item['nodes'][0]['v']=True; variants.append(item)
        item=workflow(); item['edges'][0]['from']=['start']; variants.append(item)
        item=workflow(); item['vars']['count']['python']='eval'; variants.append(item)
        for item in variants:
            with self.subTest(item=item): self.assertFalse(self.validators['robotflow.v1'].is_valid(item))

    def test_block_rejects_arbitrary_code_ports_and_missing_semantics(self):
        for change in ({'lowering':'__import__("os")'},{'id':'vehicle.drive'},{'semantics':{}},
                       {'python':'arbitrary code'},{'ports':{'outputs':{}}}):
            with self.subTest(change=change): self.assertFalse(self.validators['block.v1'].is_valid(dict(block(),**change)))

    def test_ir_rejects_unknown_opcode_missing_trace_and_incomplete_result_branches(self):
        for statement in ({'op':'shell','src':{'nodeId':'x'},'command':'run'},
                          {'op':'wait','ms':100},
                          {'op':'invoke','src':{'nodeId':'x'},'path':'Robot.Safety.Arm','args':{},'timeoutMs':1000,'on':{'succeeded':[]}},
                          {'op':'wait','src':{'nodeId':'x'},'ms':-1}):
            value=ir(); value['behaviors'][0]['body']=[statement]
            with self.subTest(statement=statement): self.assertFalse(self.validators['rfir.v1'].is_valid(value))

    def test_recursive_regions_and_all_typed_results_validate(self):
        value=ir()
        literal={'kind':'literal','type':'bool','value':True}
        terminal={'op':'noop','src':{'nodeId':'end'}}
        invoke={'op':'invoke','src':{'nodeId':'arm'},'path':'Robot.Safety.Arm','args':{},'timeoutMs':1000,
            'on':{phase:[terminal] for phase in ('succeeded','failed','rejected','cancelled','timed_out')}}
        value['behaviors'][0]['body']=[{'op':'if','src':{'nodeId':'condition'},'condition':literal,
            'then':[{'op':'loop','src':{'nodeId':'loop'},'count':2,'body':[invoke]}],
            'else':[{'op':'parallel','src':{'nodeId':'parallel'},'mode':'any','children':[[terminal],[terminal]]}]}]
        self.validators['rfir.v1'].validate(value)

    def test_discriminated_statement_remains_closed_and_loop_mode_exclusive(self):
        for statement in (
            {'op':'wait','ms':20,'body':[]},
            {'op':'loop','body':[]},
            {'op':'loop','body':[],'count':1,'forever':True},
            {'op':'loop','body':[],'forever':False},
            {'op':'loop','body':[{'op':'noop','src':{'nodeId':'nested'},'shell':'bad'}],'count':1},
        ):
            value=ir();value['behaviors'][0]['body']=[dict(statement,src={'nodeId':'step'})]
            with self.subTest(statement=statement):
                self.assertFalse(self.validators['rfir.v1'].is_valid(value))

    def test_expression_wire_rejects_type_confusion_overflow_and_arbitrary_call(self):
        expressions=[{'kind':'literal','type':'bool','value':1},
            {'kind':'literal','type':'uint8','value':256},
            {'kind':'literal','type':'int32','value':True},
            {'kind':'call','name':'__import__','args':[],'type':'string'},
            {'kind':'signal','path':'__class__','type':'string'}]
        for expression in expressions:
            value=ir(); value['behaviors'][0]['body']=[{'op':'assign','src':{'nodeId':'bad'},'name':'count','value':expression}]
            with self.subTest(expression=expression): self.assertFalse(self.validators['rfir.v1'].is_valid(value))

    def test_every_statement_and_trigger_family_has_a_valid_wire_fixture(self):
        literal={'kind':'literal','type':'float64','value':.2,'unit':'m/s'}
        condition={'kind':'literal','type':'bool','value':True}
        outcomes={phase:[] for phase in ('succeeded','failed','rejected','cancelled','timed_out')}
        statements=[{'op':'noop'},{'op':'wait','ms':20},
            {'op':'wait_until','condition':condition,'timeoutMs':100,'on':{'succeeded':[],'timed_out':[]}},
            {'op':'set_target','path':'Robot.Motion.Velocity','value':{'LinearX':literal}},
            {'op':'hold','path':'Robot.Motion.Velocity','value':{'LinearX':literal},'ms':100,'timeoutMs':1000,'on':outcomes},
            {'op':'cancel','scope':'body','timeoutMs':1000,'on':outcomes},
            {'op':'stop','timeoutMs':1000,'on':outcomes},
            {'op':'assign','name':'speed','value':literal},
            {'op':'read','path':'Robot.Velocity.Linear.X','name':'speed'},
            {'op':'loop','forever':True,'body':[{'op':'wait','src':{'nodeId':'wait'},'ms':20}]}]
        triggers=[{'kind':'start'},{'kind':'change','path':'Robot.Safety.Mode'},
            {'kind':'condition','condition':condition,'forMs':100},{'kind':'every','ms':1000},
            {'kind':'event','name':'jump'}]
        for statement in statements:
            value=ir(); value['behaviors'][0]['body']=[dict(statement,src={'nodeId':'step'})]
            with self.subTest(statement=statement['op']): self.validators['rfir.v1'].validate(value)
        for trigger in triggers:
            value=ir(); value['behaviors'][0]['trigger']=trigger
            with self.subTest(trigger=trigger): self.validators['rfir.v1'].validate(value)

    def test_rf_diagnostics_have_stable_stage_severity_and_localized_messages(self):
        catalog=json.loads(Path('/contracts/diagnostics.v1.json').read_text())
        selected={code:text for code,text in catalog['codes'].items() if code.startswith('RF')}
        self.assertGreaterEqual(len(selected),20)
        for code in selected:
            self.assertRegex(code,r'^RF[1-6][0-9]{3}$')
            detail=catalog['details'][code]
            self.assertIn(detail['severity'],('error','warning'))
            self.assertIn(detail['stage'],('S0','S1','S2','S3','S4','S5','S6'))
            self.assertTrue(detail['message']['vi'])
            self.assertTrue(detail['message']['en'])

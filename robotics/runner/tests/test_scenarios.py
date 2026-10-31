import copy,json,unittest,tempfile
from scenarios import evaluate,validate,wire,plain
from service import create_app
from fastapi.testclient import TestClient
from test_service import BusFixture

BASE={'schema':'scenario.v1','name':'Native test','timeScale':1,'durationMs':1000,'toleranceMs':0,'steps':[],
'expect':[{'kind':'invoke','path':'Robot.Motion.Perform','args':{'Name':'BOW'},'withinMs':[0,900],'phase':'SUCCEEDED','count':1}]}
class ScenarioTests(unittest.TestCase):
    def setUp(self):self.folder=tempfile.TemporaryDirectory();self.bus=BusFixture();self.catalog=json.loads(open('/contracts/fixtures/rss-go2-catalog.v1.json').read())
    def tearDown(self):self.folder.cleanup()
    def test_closed_and_catalog_typed_input_rejects_live_paths_wrong_types_and_time_scale(self):
        validate(BASE,self.catalog)
        values=[]
        for step in ({'atMs':0,'sensor':{'path':'Robot.Safety.IsArmed','quality':'OK','value':True}},
                     {'atMs':0,'sensor':{'path':'Robot.Perception.Marker.Count','quality':'OK','value':True}},
                     {'atMs':0,'sensor':{'path':'Robot.Perception.Marker.Count','quality':'NONE','value':1}},
                     {'atMs':0,'commandResult':{'path':'Robot.Safety.Arm','phase':'FAILED','count':1}}):
            values.append({**BASE,'steps':[step]})
        values.extend([{**BASE,'timeScale':2},{**BASE,'url':'http://elsewhere'}, {**BASE,'expect':[{**BASE['expect'][0],'withinMs':[900,100]}]}])
        for value in values:
            with self.subTest(value=value),self.assertRaises(Exception):validate(value,self.catalog)
    def test_actual_arguments_phase_window_count_order_and_run_fence_are_required(self):
        bound={'brokerEpoch':'epoch','fence':'2'}
        pending={'broker_epoch':'epoch','fence':2,'event':'command_phase','execution_id':'one','path':'Robot.Motion.Perform','phase':'PENDING','args':{'fields':{'Name':{'stringValue':'BOW'}}},'monotonic_ns':'100000000'}
        final={**pending,'phase':'SUCCEEDED','monotonic_ns':'200000000'}
        for audit,passed in [([pending,final],True),([{**pending,'fence':3},final],False),([pending],False),([{**pending,'args':{'fields':{'Name':{'stringValue':'JUMP'}}}},final],False),([{**pending,'monotonic_ns':'999000000'},final],False)]:
            with self.subTest(audit=audit):self.assertEqual(evaluate(BASE,audit,[],0,bound)[0][0]['passed'],passed)
    def test_empty_safety_arguments_decode_from_actual_protobuf_json(self):
        from google.protobuf.json_format import MessageToDict
        from protobus.v1 import protobus_pb2 as pb
        self.assertEqual(plain(MessageToDict(pb.Object(fields={}))),{})
    def test_forbidden_invocation_checks_pending_even_when_command_later_fails(self):
        expected={key:value for key,value in BASE['expect'][0].items() if key not in ('count','phase')};expected['kind']='forbid'
        event={'broker_epoch':'epoch','fence':2,'event':'command_phase','execution_id':'one','path':'Robot.Motion.Perform','phase':'PENDING','args':{'fields':{'Name':{'stringValue':'BOW'}}},'monotonic_ns':'100000000'}
        self.assertFalse(evaluate({**BASE,'expect':[expected]},[event],[],0,{'brokerEpoch':'epoch','fence':'2'})[0][0]['passed'])
    def test_live_runner_has_no_mock_test_endpoint_and_invalid_scenario_never_starts(self):
        with TestClient(create_app('live',self.folder.name,self.bus)) as c:
            self.assertEqual(c.post('/tests/anything',json=BASE).status_code,404)
            self.assertEqual(c.get('/tests').status_code,404)
        with TestClient(create_app('sim',self.folder.name,self.bus)) as c:
            self.assertEqual(c.post('/tests/invalid',json={**BASE,'timeScale':2}).status_code,422)
            self.assertIsNone(c.get('/status').json()['job'])

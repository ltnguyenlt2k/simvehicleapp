"""HTTP/immutable deployment unit contracts. Bus/supervisor are explicit fixtures."""
import copy,json,tempfile,unittest,uuid
from pathlib import Path
import httpx
from service import create_app
from rfrt.artifact import canonical,digest

class BusFixture:
    address='protobus-sim:55600'
    def __init__(self):self.validations=0;self.stops=0;self.reject=False
    async def validate(self,catalog,binding):
        self.validations+=1
        if self.reject:raise ValueError('fixture changed target')
    async def stop(self):self.stops+=1;return {'confirmed':True,'scope':'unit fixture'}
    async def target(self):return {'scope':'unit fixture'}
    async def live(self,catalog):return {'online':True,'samples':{},'scope':'unit fixture'}

class ProcessFixture:
    def __init__(self):self.phase='IDLE';self.starts=[];self.events=[];self.sequence=0
    def snapshot(self):return {'phase':self.phase,'exitCode':None,'safeResult':{'confirmed':True,'scope':'unit fixture'}}
    async def start(self,argv,environment):self.starts.append((argv,environment));self.phase='RUNNING'
    async def stop(self):self.phase='STOPPED';return self.snapshot()
    async def event(self,value):self.events.append(json.loads(value))
    def entries(self,after=0):return []

class RunnerHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder=tempfile.TemporaryDirectory();self.root=Path(self.folder.name)
        self.files=json.loads(Path('/fixtures/hold-files.json').read_text());lock=json.loads(self.files['rflow.lock.json'])
        self.identity=str(uuid.uuid4())
        self.target={'schema':'rftarget.v1','robotId':'dog1','profileId':lock['profileId'],
            'catalogHash':lock['catalogHash'],'context':{'kind':'KINEMATIC_MOCK',
            'mappingHash':'sha256:'+'b'*64,'adapterSourceHash':'sha256:'+'c'*64,'remoteArmAuthorized':True}}
        self.record={'schema':'rfdeploy.v1','id':self.identity,'projectId':str(uuid.uuid4()),'buildId':str(uuid.uuid4()),
            'artifactHash':lock['artifactHash'],'runtimePackageHash':lock['runtimePackageHash'],'mode':'sim',
            'targetHash':digest(canonical(self.target)),'identities':{key:lock[key] for key in ('workflowHash','sourceHash','catalogHash','profileId','profileHash','irHash','registryHash','unitsHash','compilerVersion','runtimeVersion')},
            'projectName':'Fixture','createdAt':'2026-11-01T00:00:00Z'}
        artifact=self.root/'artifacts'/lock['artifactHash'].split(':')[1]
        for name,text in self.files.items():
            path=artifact/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text)
        deployed=self.root/'deployments'/self.identity;deployed.mkdir(parents=True)
        (deployed/'record.json').write_text(json.dumps(self.record));(deployed/'target.json').write_text(json.dumps(self.target))
        self.bus=BusFixture();self.app=create_app('sim',self.root,self.bus)
        self.process=ProcessFixture();self.app.state.runner.supervisor=self.process
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app),base_url='http://runner')
    async def asyncTearDown(self):await self.client.aclose();self.folder.cleanup()
    def request(self):return {'deploymentId':self.identity,'requestId':str(uuid.uuid4())}
    async def test_start_is_explicit_fixed_destination_and_duplicate_request_never_replays(self):
        self.assertEqual(len(self.process.starts),0)
        self.assertIsNone((await self.client.get('/status')).json()['job'])
        request=self.request();one=await self.client.post('/start',json=request)
        self.assertEqual(one.status_code,200,one.text)
        two=await self.client.post('/start',json=request)
        self.assertEqual(two.json()['id'],one.json()['id']);self.assertEqual(len(self.process.starts),1)
        argv,environment=self.process.starts[0]
        self.assertEqual(argv[argv.index('--bus')+1],'protobus-sim:55600')
        self.assertNotIn('PYTHONPATH',environment)
        response=await self.client.post('/start',json=self.request())
        self.assertEqual(response.status_code,409);self.assertEqual(len(self.process.starts),1)
    async def test_tampered_target_source_and_mode_are_refused_before_process_start(self):
        folder=self.root/'deployments'/self.identity
        for key,value in (('mode','live'),('targetHash','sha256:'+'d'*64),('runtimePackageHash','sha256:'+'e'*64)):
            changed={**self.record,key:value};(folder/'record.json').write_text(json.dumps(changed))
            response=await self.client.post('/start',json=self.request());self.assertEqual(response.status_code,409)
            self.assertFalse(self.process.starts)
        (folder/'record.json').write_text(json.dumps(self.record))
        self.bus.reject=True
        response=await self.client.post('/start',json=self.request());self.assertEqual(response.status_code,409)
        self.assertFalse(self.process.starts)
    async def test_closed_inputs_and_limits_cannot_select_bus_or_executable(self):
        for extra in ({'bus':'live'},{'argv':['arbitrary']},{'maxRunMs':True},{'maxRunMs':3600001}):
            response=await self.client.post('/start',json={**self.request(),**extra})
            self.assertEqual(response.status_code,422);self.assertFalse(self.process.starts)
        response=await self.client.post('/start',json={'deploymentId':'../escape','requestId':str(uuid.uuid4())})
        self.assertEqual(response.status_code,422)
    async def test_idle_stop_is_independent_and_event_is_a_closed_record(self):
        response=await self.client.post('/stop')
        self.assertTrue(response.json()['safety']['confirmed']);self.assertEqual(self.bus.stops,1)
        request=self.request();await self.client.post('/start',json=request)
        response=await self.client.post('/event',json={'id':'one','name':'jump'})
        self.assertTrue(response.json()['accepted'])
        self.assertEqual(self.process.events,[{'schema':'rfevent.v1','id':'one','name':'jump'}])
        response=await self.client.post('/event',json={'id':'one','name':'jump','url':'other'})
        self.assertEqual(response.status_code,422)
    async def test_service_restart_keeps_deployment_but_does_not_resume_any_process(self):
        await self.client.post('/start',json=self.request())
        restarted=create_app('sim',self.root,BusFixture())
        self.assertIsNone(restarted.state.runner.status()['job'])
        self.assertEqual(restarted.state.runner.supervisor.phase,'IDLE')
        self.assertTrue((self.root/'deployments'/self.identity/'record.json').exists())

    async def test_verified_build_check_never_acquires_authority_or_starts_a_child(self):
        response=await self.client.post('/verify',json={'artifactHash':self.record['artifactHash']})
        self.assertEqual(response.status_code,200,response.text);self.assertTrue(response.json()['verified'])
        self.assertFalse(self.process.starts);self.assertEqual(self.bus.validations,0)
        artifact=self.root/'artifacts'/self.record['artifactHash'].split(':')[1]/'app/flow.py'
        artifact.write_text('tampered')
        response=await self.client.post('/verify',json={'artifactHash':self.record['artifactHash']})
        self.assertEqual(response.status_code,409);self.assertFalse(self.process.starts)
    async def test_control_body_budget_and_duplicate_keys_are_rejected_before_validation(self):
        response=await self.client.post('/start',content=b'x'*131073)
        self.assertEqual(response.status_code,413);self.assertFalse(self.process.starts)
        response=await self.client.post('/event',content=b'{"id":"one","id":"two","name":"jump"}',headers={'Content-Type':'application/json'})
        self.assertEqual(response.status_code,422);self.assertFalse(self.process.events)

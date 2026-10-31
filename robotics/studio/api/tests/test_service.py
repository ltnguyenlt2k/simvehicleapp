"""Studio HTTP contracts with explicit remote-service fixtures; no execution claims."""
import copy,io,json,tempfile,unittest,uuid,zipfile
from pathlib import Path
import httpx
from fastapi import HTTPException
from service import create_app

ORIGIN='http://localhost:3180'
KEY='unit-zoo-capability-'+('x'*32)

class ServicesFixture:
    def __init__(self):
        self.files=json.loads(Path('/fixtures/store-app.json').read_text())
        self.workflow=json.loads(self.files['workflow.json']);self.lock=json.loads(self.files['rflow.lock.json'])
        self.starts=[];self.calls=[];self.fail_start=False;self.job=None
    async def compiler(self,method,path,data=None):
        self.calls.append(('compiler',method,path))
        if path=='/templates':return {'templates':{'RW-C':self.workflow}}
        if path=='/rss/catalog':return {'catalogHash':self.lock['catalogHash'],'nodes':{}}
        if path=='/blocks':return {'blocks':[]}
        if path in ('/lint','/build'):
            if not data['authorizeSimArm']:return {'ok':False,'diagnostics':[{'code':'RF6003'}],'files':None}
            return {'ok':True,'diagnostics':[],'files':copy.deepcopy(self.files)}
        raise AssertionError(path)
    async def runner(self,mode,method,path,data=None):
        self.calls.append((mode,method,path))
        if path=='/capabilities':return {'mode':mode,'runtime':{'packageHash':'sha256:'+'a'*64}}
        if path=='/verify':return {'verified':True}
        if path=='/target':
            context={'kind':'KINEMATIC_MOCK','mappingHash':'sha256:'+'b'*64,'adapterSourceHash':'sha256:'+'c'*64,'remoteArmAuthorized':True}
            if mode=='live':context.update(kind='ROS_SIM',sourceEpoch='fixture-epoch',brainBootId='fixture-brain',sceneEpoch='fixture-scene',configHash='d'*64,sceneId='courtyard',mapGeneration='fixture-map')
            return {'schema':'rftarget.v1','robotId':'dog1','profileId':self.lock['profileId'],'catalogHash':self.lock['catalogHash'],'context':context}
        if path=='/start':
            self.starts.append(data);self.job={'id':str(uuid.uuid4()),'deploymentId':data['deploymentId'],'phase':'RUNNING'}
            if self.fail_start:raise HTTPException(503,'fixture lost acknowledgement')
            return self.job
        if path=='/status':return {'mode':mode,'job':self.job}
        if path=='/live':return {'online':True,'samples':{},'scope':'unit fixture'}
        if path.startswith('/logs'):return {'jobId':None,'entries':[],'latest':0}
        if path=='/stop':return {'safety':{'confirmed':True,'scope':'unit fixture'}}
        if path=='/event':return {'accepted':True}
        if path=='/tests':return {'report':None}
        if path.startswith('/tests/'):return {'phase':'RUNNING','scope':'unit fixture'}
        raise AssertionError(path)

class StudioHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder=tempfile.TemporaryDirectory();self.services=ServicesFixture()
        self.app=create_app(self.folder.name,self.services,KEY)
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app),base_url='http://studio',headers={'Origin':ORIGIN})
    async def asyncTearDown(self):await self.client.aclose();self.folder.cleanup()
    async def built(self):
        response=await self.client.post('/projects',json={'name':'Mission','template':'RW-C'})
        self.assertEqual(response.status_code,200,response.text);project=response.json()
        response=await self.client.post('/projects/'+project['id']+'/build',json={'revision':1,'authorizeSimArm':True})
        self.assertEqual(response.status_code,200,response.text);self.assertTrue(response.json()['ok'])
        return project,response.json()['build']
    async def deployed(self,mode='sim'):
        project,build=await self.built()
        response=await self.client.post('/deployments',json={'buildId':build['id'],'mode':mode})
        self.assertEqual(response.status_code,200,response.text)
        return project,build,response.json()
    async def test_create_save_build_deploy_are_readiness_actions_never_start(self):
        project,build,deployment=await self.deployed()
        self.assertFalse(self.services.starts)
        self.assertNotIn('projectSnapshot',build)
        self.assertEqual(deployment['artifactHash'],build['artifactHash'])
        self.assertEqual(len((await self.client.get('/projects')).json()['projects']),1)
        self.assertEqual((await self.client.get('/projects/'+project['id'])).json()['revision'],1)
        value=await self.client.get('/projects/'+project['id']+'/deployments')
        self.assertEqual(value.json()['deployments'][0]['id'],deployment['id'])
        self.assertFalse(list((Path(self.folder.name)/'requests').iterdir()))
    async def test_optimistic_revision_and_unapproved_arm_do_not_publish_build(self):
        created=await self.client.post('/projects',json={'name':'Mission','template':'RW-C'});project=created.json()
        denied=await self.client.post('/projects/'+project['id']+'/build',json={'revision':1})
        self.assertFalse(denied.json()['ok'])
        self.assertFalse(list((Path(self.folder.name)/'builds').iterdir()))
        body={'revision':1,'name':'Changed','workflow':project['workflow']}
        self.assertEqual((await self.client.put('/projects/'+project['id'],json=body)).status_code,200)
        self.assertEqual((await self.client.put('/projects/'+project['id'],json=body)).status_code,409)
        self.assertEqual((await self.client.post('/projects/'+project['id']+'/build',json={'revision':1,'authorizeSimArm':True})).status_code,409)
    async def test_start_is_explicit_once_and_lost_ack_cannot_replay_after_api_restart(self):
        _,_,deployment=await self.deployed();key=str(uuid.uuid4());body={'requestId':key}
        self.services.fail_start=True
        self.assertEqual((await self.client.post('/deployments/'+deployment['id']+'/start',json=body)).status_code,503)
        self.assertEqual(len(self.services.starts),1)
        restarted=create_app(self.folder.name,self.services,KEY)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=restarted),base_url='http://studio',headers={'Origin':ORIGIN}) as client:
            result=await client.post('/deployments/'+deployment['id']+'/start',json=body)
            self.assertEqual(result.status_code,409);self.assertEqual(len(self.services.starts),1)
            status=(await client.get('/snapshot/sim')).json()
            self.assertEqual(status['status']['job']['phase'],'RUNNING')
    async def test_local_origin_and_zoo_capability_cannot_be_bypassed(self):
        response=await self.client.post('/projects',json={'name':'Blocked'},headers={'Origin':'https://external.example'})
        self.assertEqual(response.status_code,403);self.assertFalse(self.services.calls)
        _,_,deployment=await self.deployed('live')
        path='/zoo/deployments/'+deployment['id']
        self.assertEqual((await self.client.get(path)).status_code,403)
        self.assertEqual((await self.client.get(path,headers={'X-Zoo-Capability':'wrong'})).status_code,403)
        response=await self.client.get(path,headers={'X-Zoo-Capability':KEY})
        self.assertEqual(response.status_code,200,response.text);self.assertFalse(self.services.starts)
        response=await self.client.post(path+'/start',json={'requestId':str(uuid.uuid4())},headers={'X-Zoo-Capability':KEY,'Origin':'http://127.0.0.1:8092'})
        self.assertEqual(response.status_code,200,response.text);self.assertEqual(len(self.services.starts),1)
    async def test_zoo_rejects_mock_deployment_and_payload_cannot_choose_execution_url(self):
        _,_,deployment=await self.deployed()
        result=await self.client.get('/zoo/deployments/'+deployment['id'],headers={'X-Zoo-Capability':KEY})
        self.assertEqual(result.status_code,409)
        result=await self.client.post('/deployments/'+deployment['id']+'/start',json={'requestId':str(uuid.uuid4()),'bus':'other'})
        self.assertEqual(result.status_code,422);self.assertFalse(self.services.starts)
    async def test_export_contains_frozen_editor_source_and_verified_native_files(self):
        project,build,deployment=await self.deployed()
        await self.client.put('/projects/'+project['id'],json={'revision':1,'name':'Later change','workflow':project['workflow']})
        response=await self.client.get('/deployments/'+deployment['id']+'/export')
        self.assertEqual(response.status_code,200,response.text if response.status_code!=200 else '')
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertEqual(len(archive.namelist()),13)
            self.assertEqual(json.loads(archive.read('project.json'))['name'],'Mission')
            self.assertEqual(json.loads(archive.read('rflow.lock.json'))['artifactHash'],deployment['artifactHash'])
            self.assertEqual(json.loads(archive.read('deployment.json'))['id'],deployment['id'])
    async def test_closed_and_duplicate_json_is_rejected_before_remote_actions(self):
        response=await self.client.post('/projects',content=b'{"name":"A","name":"B"}',headers={'Content-Type':'application/json'})
        self.assertEqual(response.status_code,422);self.assertFalse(self.services.calls)
        response=await self.client.post('/projects',json={'name':'Mission','python':'arbitrary'})
        self.assertEqual(response.status_code,422);self.assertFalse(self.services.calls)
        response=await self.client.post('/control/real/stop')
        self.assertEqual(response.status_code,422)

    async def test_frozen_source_and_zoo_link_are_read_only_and_only_carry_identity(self):
        project,_,deployment=await self.deployed('live')
        await self.client.put('/projects/'+project['id'],json={'revision':1,'name':'New draft','workflow':project['workflow']})
        response=await self.client.get('/deployments/'+deployment['id']+'/source')
        self.assertEqual(response.status_code,200);self.assertEqual(response.json()['name'],'Mission')
        link=(await self.client.get('/deployments/'+deployment['id']+'/zoo-link')).json()['url']
        self.assertEqual(link,'http://127.0.0.1:8092/?deployment='+deployment['id'])
        self.assertFalse(self.services.starts)

    async def test_scenario_interface_is_fixed_to_mock_and_live_never_forwards_test(self):
        _,_,deployment=await self.deployed('live')
        before=list(self.services.calls)
        response=await self.client.post('/deployments/'+deployment['id']+'/test',json={'schema':'scenario.v1'})
        self.assertEqual(response.status_code,409)
        self.assertEqual(self.services.calls,before)
        _,_,deployment=await self.deployed('sim')
        response=await self.client.post('/deployments/'+deployment['id']+'/test',json={'schema':'scenario.v1'})
        self.assertEqual(response.status_code,200)
        self.assertEqual(self.services.calls[-1],('sim','POST','/tests/'+deployment['id']))
        self.assertEqual((await self.client.get('/tests')).json(),{'report':None})
        self.assertEqual(self.services.calls[-1],('sim','GET','/tests'))
        self.assertFalse(self.services.starts)

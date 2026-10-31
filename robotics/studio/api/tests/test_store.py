"""Real Linux file store tests; compiler data fixture, no runtime execution."""
import copy,json,os,tempfile,threading,unittest,uuid
from pathlib import Path
from store import Store,Conflict,Missing,FILES,canonical,digest

class StoreTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.root=Path(self.directory.name)
        self.store=Store(self.root)
        self.files=json.loads(Path('/fixtures/store-app.json').read_text())
        self.workflow=json.loads(self.files['workflow.json'])
        self.pin='sha256:'+'a'*64
        lock=json.loads(self.files['rflow.lock.json'])
        self.target={'schema':'rftarget.v1','robotId':'dog1','profileId':lock['profileId'],
            'catalogHash':lock['catalogHash'],'context':{'kind':'KINEMATIC_MOCK','mappingHash':'sha256:'+'b'*64,
            'adapterSourceHash':'sha256:'+'c'*64,'remoteArmAuthorized':True}}
    def tearDown(self):self.directory.cleanup()
    def built(self):
        project=self.store.create('Mission',self.workflow)
        build=self.store.publish_build(project['id'],1,self.files,self.pin)
        return project,build
    def test_atomic_revision_survives_reopen_and_rejects_lost_update(self):
        project=self.store.create('  Mission  ',self.workflow)
        saved=self.store.save(project['id'],1,'New name',self.workflow)
        self.assertEqual(saved['revision'],2)
        reopened=Store(self.root);self.assertEqual(reopened.get(project['id']),saved)
        self.assertEqual(reopened.list()[0]['name'],'New name')
        with self.assertRaises(Conflict):self.store.save(project['id'],1,'Lost',self.workflow)
        with self.assertRaises(Conflict):self.store.save(project['id'],True,'Lost',self.workflow)
        self.assertEqual(reopened.get(project['id'])['name'],'New name')
    def test_two_concurrent_saves_only_one_can_use_same_revision(self):
        project=self.store.create('Mission',self.workflow);results=[]
        def save(name):
            try:self.store.save(project['id'],1,name,self.workflow);results.append('saved')
            except Conflict:results.append('conflict')
        threads=[threading.Thread(target=save,args=(str(index),)) for index in range(2)]
        for thread in threads:thread.start()
        for thread in threads:thread.join(3);self.assertFalse(thread.is_alive())
        self.assertEqual(sorted(results),['conflict','saved'])
    def test_exact_compiler_artifacts_are_immutable_and_corruption_is_detected(self):
        project,build=self.built()
        again=self.store.publish_build(project['id'],1,self.files,self.pin)
        self.assertEqual(build['artifactHash'],again['artifactHash'])
        self.assertEqual(len(list((self.root/'artifacts').iterdir())),1)
        altered=copy.deepcopy(self.files);altered['app/flow.py']+='print("tampered")'
        with self.assertRaises(ValueError):self.store.publish_build(project['id'],1,altered,self.pin)
        for wrong in ({**self.files,'../escape.py':'x'},{k:v for k,v in self.files.items() if k!='app/main.py'}):
            with self.assertRaises(ValueError):self.store.publish_build(project['id'],1,wrong,self.pin)
        artifact=self.root/'artifacts'/build['artifactHash'].split(':')[1]/'app/flow.py'
        artifact.write_text('changed locally')
        with self.assertRaises(ValueError):self.store.publish_build(project['id'],1,self.files,self.pin)
    def test_build_does_not_publish_after_project_revision_changed(self):
        project=self.store.create('Mission',self.workflow)
        self.store.save(project['id'],1,'Changed',self.workflow)
        with self.assertRaises(Conflict):self.store.publish_build(project['id'],1,self.files,self.pin)
        self.assertFalse(list((self.root/'artifacts').iterdir()))
    def test_deployment_freezes_target_and_source_and_never_writes_run_request(self):
        project,build=self.built();value=self.store.deploy(build['id'],'sim',self.target)
        targetfile=self.root/'deployments'/value['id']/'target.json'
        self.assertEqual(json.loads(targetfile.read_text()),self.target)
        self.assertEqual(value['targetHash'],digest(canonical(self.target)))
        self.assertEqual(value['identities']['workflowHash'],build['identities']['workflowHash'])
        self.assertEqual(self.store.deployment(value['id']),value)
        self.assertEqual(self.store.deployments(project['id']),[value])
        self.assertFalse(list((self.root/'requests').iterdir()))
        self.store.save(project['id'],1,'Later edits',self.workflow)
        self.assertEqual(self.store.deployment(value['id']),value)
        with self.assertRaises(Conflict):self.store.deploy(build['id'],'sim',self.target)
    def test_mode_permission_catalog_and_runtime_mismatches_are_rejected(self):
        project,build=self.built()
        with self.assertRaises(ValueError):self.store.deploy(build['id'],'live',self.target)
        denied=copy.deepcopy(self.target);denied['context']['remoteArmAuthorized']=False
        with self.assertRaises(ValueError):self.store.deploy(build['id'],'sim',denied)
        wrong=copy.deepcopy(self.target);wrong['catalogHash']='sha256:'+'d'*64
        with self.assertRaises(ValueError):self.store.deploy(build['id'],'sim',wrong)
        with self.assertRaises(ValueError):self.store.publish_build(project['id'],1,self.files,'sha256:'+'f'*64)
        self.assertFalse(list((self.root/'deployments').iterdir()))
    def test_start_request_is_durable_spent_and_cannot_replay_after_restart(self):
        _,build=self.built();deployment=self.store.deploy(build['id'],'sim',self.target)
        key=str(uuid.uuid4());self.store.reserve_start(key,deployment['id'])
        reopened=Store(self.root)
        with self.assertRaises(Conflict):reopened.reserve_start(key,deployment['id'])
        self.assertEqual(len(list((self.root/'requests').iterdir())),1)
    def test_path_traversal_symlink_names_and_record_budgets_are_enforced(self):
        for name in ('../escape','/tmp/other','not-a-uuid'):
            with self.assertRaises(ValueError):self.store.get(name)
        for name in ('','  ','bad\nname'):
            with self.assertRaises(ValueError):self.store.create(name,self.workflow)
        with self.assertRaises(ValueError):self.store.create('Invalid',{'python':'exec(...)'})
        self.store.budgets['projects']=1
        project=self.store.create('Mission',self.workflow)
        with self.assertRaises(ValueError):self.store.create('Over budget',self.workflow)
        path=self.root/'projects'/(project['id']+'.json');path.unlink();path.symlink_to('/etc/passwd')
        with self.assertRaises(ValueError):self.store.get(project['id'])

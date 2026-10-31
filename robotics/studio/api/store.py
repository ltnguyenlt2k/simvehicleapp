"""Single-writer project store and immutable compiler/deployment publication."""
from contextlib import contextmanager
from datetime import datetime,timezone
import fcntl,hashlib,json,os,re,shutil,stat,tempfile,uuid
from pathlib import Path
from jsonschema import Draft202012Validator,ValidationError

UUID=re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
HASH=re.compile(r'sha256:[0-9a-f]{64}')
FILES={'app/__init__.py','app/flow.py','app/main.py','rfir.json','rss-catalog.json',
       'profile.json','units.v1.json','registry.json','workflow.json','rflow.lock.json'}

class Conflict(ValueError):pass
class Missing(ValueError):pass


def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
def digest(value):return 'sha256:'+hashlib.sha256(value).hexdigest()
def now():return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def identity(value):
    if not isinstance(value,str) or UUID.fullmatch(value) is None:raise ValueError('invalid record identity')
    return value

def label(value):
    if not isinstance(value,str) or not 1<=len(value.strip())<=96 or any(ord(c)<32 for c in value):
        raise ValueError('project name must contain 1..96 printable characters')
    return value.strip()


class Store:
    def __init__(self,root,contracts='/contracts'):
        self.root=Path(root);self.root.mkdir(parents=True,exist_ok=True)
        if self.root.is_symlink():raise ValueError('project root must not be a symlink')
        self.contracts=Path(contracts)
        self.graph_validator=Draft202012Validator(json.loads((self.contracts/'robotflow.v1.json').read_text()))
        self.target_validator=Draft202012Validator(json.loads((self.contracts/'rftarget.v1.json').read_text()))
        self.lock_validator=Draft202012Validator(json.loads((self.contracts/'rflow-lock.v1.json').read_text()))
        self.validators={kind:Draft202012Validator(json.loads((self.contracts/'studio'/name).read_text())) for kind,name in (('rfproject.v1','project.v1.json'),('rfbuild.v1','build.v1.json'),('rfdeploy.v1','deployment.v1.json'),('rfstart.v1','start.v1.json'))}
        self.budgets={'projects':200,'builds':1000,'deployments':1000,'artifacts':256,'requests':2000}
        for section in self.budgets:
            folder=self.root/section
            if folder.is_symlink():raise ValueError('project section must not be a symlink')
            folder.mkdir(exist_ok=True)

    @contextmanager
    def locked(self):
        fd=os.open(self.root/'.writer.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
        try:fcntl.flock(fd,fcntl.LOCK_EX);yield
        finally:fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)

    def _budget(self,section):
        if len(list((self.root/section).iterdir()))>=self.budgets[section]:raise ValueError('local record budget reached')

    def _read_bytes(self,path,maximum):
        parts=path.relative_to(self.root).parts
        descriptors=[]
        try:
            current=os.open(self.root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            descriptors.append(current)
            for part in parts[:-1]:
                current=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=current)
                descriptors.append(current)
            fd=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=current)
            descriptors.append(fd);info=os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size>maximum:raise ValueError('invalid record file')
            with os.fdopen(os.dup(fd),'rb') as stream:raw=stream.read(maximum+1)
            if len(raw)>maximum:raise ValueError('record exceeds read budget')
            return raw
        except FileNotFoundError:raise Missing('record does not exist')
        except OSError:raise ValueError('unsafe record path')
        finally:
            for descriptor in reversed(descriptors):os.close(descriptor)

    def _read(self,path):
        value=json.loads(self._read_bytes(path,2*1024*1024));canonical(value)
        self._record(value)
        return value

    def _record(self,value):
        if not isinstance(value,dict):raise ValueError('record must be an object')
        validator=self.target_validator if value.get('schema')=='rftarget.v1' else self.validators.get(value.get('schema'))
        if validator is None:raise ValueError('unknown record schema')
        if validator is not None:
            try:validator.validate(value)
            except ValidationError:raise ValueError('record schema is invalid')

    def _write(self,path,value):
        self._record(value)
        raw=canonical(value)
        if len(raw)>2*1024*1024:raise ValueError('record exceeds size budget')
        fd,name=tempfile.mkstemp(prefix='.write-',dir=path.parent)
        try:
            with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
            os.replace(name,path)
        finally:
            if os.path.exists(name):os.unlink(name)

    def _workflow(self,value):
        if len(canonical(value))>1024*1024:raise ValueError('workflow exceeds compiler budget')
        try:self.graph_validator.validate(value)
        except ValidationError:raise ValueError('workflow shape is invalid')

    def create(self,name,workflow):
        self._workflow(workflow)
        value=dict(schema='rfproject.v1',id=str(uuid.uuid4()),name=label(name),revision=1,
                   updatedAt=now(),workflow=workflow)
        with self.locked():
            self._budget('projects');self._write(self.root/'projects'/(value['id']+'.json'),value)
        return value

    def get(self,project_id):
        with self.locked():return self._read(self.root/'projects'/(identity(project_id)+'.json'))

    def list(self):
        with self.locked():
            values=[self._read(path) for path in sorted((self.root/'projects').glob('*.json'))]
        return sorted([{k:v[k] for k in ('id','name','revision','updatedAt')} for v in values],key=lambda v:v['updatedAt'],reverse=True)

    def save(self,project_id,revision,name,workflow):
        self._workflow(workflow)
        with self.locked():
            path=self.root/'projects'/(identity(project_id)+'.json');value=self._read(path)
            if type(revision) is not int or revision!=value['revision']:raise Conflict('project changed; reload before saving')
            value.update(name=label(name),workflow=workflow,revision=revision+1,updatedAt=now())
            self._write(path,value);return value

    def check_files(self,files,runtime_pin):
        if not isinstance(files,dict) or set(files)!=FILES or HASH.fullmatch(runtime_pin) is None:
            raise ValueError('exact compiler file set and runtime identity required')
        if any(not isinstance(text,str) or len(text.encode())>4*1024*1024 for text in files.values()):
            raise ValueError('compiler file exceeds budget')
        if sum(len(text.encode()) for text in files.values())>16*1024*1024:raise ValueError('compiler bundle exceeds budget')
        lock=json.loads(files['rflow.lock.json'])
        try:self.lock_validator.validate(lock)
        except ValidationError:raise ValueError('invalid compiler lock schema')
        artifact=lock.get('artifactHash')
        if not isinstance(artifact,str) or HASH.fullmatch(artifact) is None:raise ValueError('artifact hash required')
        if lock.get('runtimePackageHash')!=runtime_pin:raise ValueError('compiler runtime identity differs')
        if set(lock.get('files',{}))!=FILES-{'rflow.lock.json'}:raise ValueError('exact locked files required')
        if any(digest(files[name].encode())!=wanted for name,wanted in lock['files'].items()):raise ValueError('compiler bytes differ from lock')
        if digest(canonical({k:v for k,v in lock.items() if k!='artifactHash'}))!=artifact:raise ValueError('compiler artifact hash differs')
        return artifact

    def publish_build(self,project_id,revision,files,runtime_pin):
        artifact=self.check_files(files,runtime_pin)
        with self.locked():
            project=self._read(self.root/'projects'/(identity(project_id)+'.json'))
            if type(revision) is not int or project['revision']!=revision:raise Conflict('project changed during compilation')
            folder=self.root/'artifacts'/artifact.split(':')[1]
            if folder.is_symlink():raise ValueError('unsafe artifact directory')
            if folder.exists():
                for name,text in files.items():
                    existing=self._read_bytes(folder/name,4*1024*1024)
                    if existing!=text.encode():raise ValueError('immutable artifact was modified')
            else:
                self._budget('artifacts')
                temporary=Path(tempfile.mkdtemp(prefix='.publish-',dir=folder.parent))
                try:
                    for name,text in files.items():
                        path=temporary/name;path.parent.mkdir(exist_ok=True);path.write_bytes(text.encode())
                    os.rename(temporary,folder)
                finally:
                    if temporary.exists():shutil.rmtree(temporary)
            self._budget('builds')
            lock=json.loads(files['rflow.lock.json'])
            identities={key:lock[key] for key in ('workflowHash','sourceHash','catalogHash','profileId','profileHash','irHash','registryHash','unitsHash','compilerVersion','runtimeVersion')}
            value=dict(schema='rfbuild.v1',id=str(uuid.uuid4()),projectId=project_id,
                projectRevision=revision,artifactHash=artifact,runtimePackageHash=runtime_pin,
                allowRemoteArm=json.loads(files['profile.json'])['allowRemoteArm'],identities=identities,projectSnapshot=project,createdAt=now())
            self._write(self.root/'builds'/(value['id']+'.json'),value);return value

    def build(self,build_id):
        with self.locked():return self._read(self.root/'builds'/(identity(build_id)+'.json'))

    def deploy(self,build_id,mode,target):
        if mode not in ('sim','live'):raise ValueError('explicit supported mode required')
        try:self.target_validator.validate(target)
        except ValidationError:raise ValueError('target shape is invalid')
        expected='KINEMATIC_MOCK' if mode=='sim' else 'ROS_SIM'
        if target['context']['kind']!=expected:raise ValueError('target does not match deployment mode')
        with self.locked():
            build=self._read(self.root/'builds'/(identity(build_id)+'.json'))
            if target['catalogHash']!=build['identities']['catalogHash'] or target['profileId']!=build['identities']['profileId']:
                raise ValueError('target catalog/profile differs from compiled artifact')
            project=self._read(self.root/'projects'/(build['projectId']+'.json'))
            if project['revision']!=build['projectRevision']:raise Conflict('project changed since build')
            if build['allowRemoteArm'] and not target['context'].get('remoteArmAuthorized',False):
                raise ValueError('target does not permit explicit SIM Arm')
            self._budget('deployments')
            value=dict(schema='rfdeploy.v1',id=str(uuid.uuid4()),projectId=build['projectId'],
                buildId=build_id,artifactHash=build['artifactHash'],runtimePackageHash=build['runtimePackageHash'],
                mode=mode,targetHash=digest(canonical(target)),identities=build['identities'],projectName=build['projectSnapshot']['name'],createdAt=now())
            folder=self.root/'deployments'/value['id']
            temporary=Path(tempfile.mkdtemp(prefix='.publish-',dir=folder.parent))
            try:
                self._write(temporary/'target.json',target);self._write(temporary/'record.json',value)
                os.rename(temporary,folder)
            finally:
                if temporary.exists():shutil.rmtree(temporary)
            return value

    def deployment(self,deployment_id):
        with self.locked():return self._read(self.root/'deployments'/identity(deployment_id)/'record.json')

    def deployments(self,project_id):
        identity(project_id)
        with self.locked():
            result=[self._read(folder/'record.json') for folder in (self.root/'deployments').iterdir() if not folder.name.startswith('.')]
        return sorted([value for value in result if value['projectId']==project_id],key=lambda v:v['createdAt'],reverse=True)

    def reserve_start(self,request_id,deployment_id):
        identity(request_id);identity(deployment_id)
        with self.locked():
            path=self.root/'requests'/(request_id+'.json')
            if path.exists():raise Conflict('start request already consumed; inspect status before an explicit new start')
            self._budget('requests')
            self._write(path,dict(schema='rfstart.v1',id=request_id,deploymentId=deployment_id,createdAt=now()))

"""Verify immutable application bytes before importing generated Python."""
from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import stat
from types import MappingProxyType

from jsonschema import Draft202012Validator

FILES=frozenset(('app/__init__.py','app/flow.py','app/main.py','rfir.json',
    'rss-catalog.json','profile.json','units.v1.json','registry.json','workflow.json'))
META=('compilerVersion','runtimeVersion','workflowHash','irHash','catalogHash',
      'profileId','profileHash','unitsHash','registryHash')


class ArtifactError(ValueError):pass


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()


def digest(value):return 'sha256:'+hashlib.sha256(value).hexdigest()


def decode(raw):
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise ArtifactError('duplicate JSON key')
            result[key]=value
        return result
    def number(text):
        value=float(text)
        if not math.isfinite(value):raise ArtifactError('nonfinite JSON number')
        return value
    try:
        return json.loads(raw,object_pairs_hook=unique,
            parse_float=number,
            parse_constant=lambda value:(_ for _ in ()).throw(ArtifactError('nonfinite JSON')))
    except (ValueError,UnicodeError,RecursionError) as error:
        raise ArtifactError('invalid artifact JSON') from error


@dataclass(frozen=True)
class VerifiedApplication:
    # Callers execute these exact checked bytes, never reopen application source.
    files:object
    artifact_hash:str

    def json(self,path):return decode(self.files[path])


def read_file(root,path):
    # O_NOFOLLOW on every component prevents symlink substitution during opening.
    descriptors=[]
    try:
        current=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        descriptors.append(current)
        parts=path.split('/')
        for part in parts[:-1]:
            current=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=current)
            descriptors.append(current)
        fd=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=current)
        descriptors.append(fd);info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size>4*1024*1024:
            raise ArtifactError('regular artifact file <=4 MiB required')
        with os.fdopen(os.dup(fd),'rb') as handle:raw=handle.read(4*1024*1024+1)
        if len(raw)>4*1024*1024:raise ArtifactError('artifact file grew beyond limit')
        return raw
    except OSError as error:raise ArtifactError('missing or unsafe artifact path: '+path) from error
    finally:
        for fd in reversed(descriptors):os.close(fd)


def verify_application(root,installed_runtime_hash,contracts='/contracts'):
    """installed_runtime_hash comes from the trusted runtime image, not the app.

    This proves identity/integrity, not trust in arbitrary Python. The runner must
    accept only compiler-produced artifacts and isolate application processes.
    """
    files={name:read_file(root,name) for name in sorted(FILES|{'rflow.lock.json'})}
    found=set()
    for folder,directories,names in os.walk(root,followlinks=False):
        relative=Path(folder).relative_to(root)
        for name in directories:
            child=Path(folder)/name
            if child.is_symlink() or (relative/name).as_posix()!='app':
                raise ArtifactError('unexpected application directory')
        for name in names:
            child=Path(folder)/name
            if child.is_symlink():raise ArtifactError('unexpected application symlink')
            found.add((relative/name).as_posix())
    if found!=FILES|{'rflow.lock.json'}:raise ArtifactError('unexpected application file set')
    if sum(map(len,files.values()))>16*1024*1024:raise ArtifactError('application exceeds 16 MiB')
    lock=decode(files['rflow.lock.json'])
    def validate(name,value):
        try:Draft202012Validator(decode((Path(contracts)/(name+'.json')).read_bytes())).validate(value)
        except Exception as error:raise ArtifactError('invalid '+name) from error
    validate('rflow-lock.v1',lock)
    if (not installed_runtime_hash or lock.get('runtimePackageHash')!=installed_runtime_hash
            or lock['runtimeVersion']!='0.1.0'):
        raise ArtifactError('missing or mismatched installed runtime package pin')
    unsigned={key:value for key,value in lock.items() if key!='artifactHash'}
    if digest(canonical(unsigned))!=lock['artifactHash']:raise ArtifactError('artifact hash mismatch')
    if set(lock['files'])!=FILES:raise ArtifactError('unexpected application file set')
    for path in FILES:
        if digest(files[path])!=lock['files'][path]:raise ArtifactError('file hash mismatch: '+path)
    sources={path:lock['files'][path] for path in sorted(FILES) if path.startswith('app/')}
    if digest(canonical(sources))!=lock['sourceHash']:raise ArtifactError('source hash mismatch')
    data={path:decode(files[path]) for path in FILES if path.endswith('.json')}
    ir=data['rfir.json'];catalog=data['rss-catalog.json'];profile=data['profile.json']
    validate('rfir.v1',ir);validate('robotflow.v1',data['workflow.json']);validate('robotflow-profile.v1',profile)
    identities={'workflowHash':digest(canonical(data['workflow.json'])),
        'profileHash':digest(canonical(profile)),'unitsHash':digest(canonical(data['units.v1.json'])),
        'registryHash':digest(canonical(data['registry.json']['blocks'])),
        'irHash':digest(canonical({key:value for key,value in ir.items() if key!='irHash'})),
        'catalogHash':digest(canonical({key:value for key,value in catalog.items() if key!='catalogHash'}))}
    for name,value in identities.items():
        if lock[name]!=value:raise ArtifactError(name+' identity mismatch')
    if (data['registry.json'].get('registryHash')!=lock['registryHash']
            or catalog.get('catalogHash')!=lock['catalogHash'] or ir['irHash']!=lock['irHash']
            or any(ir[name]!=lock[name] for name in ('catalogHash','profileHash','unitsHash','runtimeVersion'))
            or ir['profile']!=lock['profileId'] or profile['id']!=lock['profileId']
            or profile['catalogHash']!=lock['catalogHash']
            or data['workflow.json']['rss']['catalogHash']!=lock['catalogHash']):
        raise ArtifactError('cross-artifact identity mismatch')
    return VerifiedApplication(MappingProxyType(files),lock['artifactHash'])

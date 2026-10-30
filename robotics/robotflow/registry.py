"""Data-only block registry shared by compiler and future palette API."""
import copy
import hashlib
import json
import math
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator,ValidationError

LOWERINGS=frozenset(('on_start','on_change','on_condition','every','on_event',
    'arm','disarm','stop','reset_stop','move','go_to','patrol','perform','cancel',
    'if','wait','wait_until','loop','parallel','assign','read','log','join','end'))
RESULTS=frozenset(('succeeded','failed','rejected','cancelled','timed_out'))


class RegistryError(ValueError): pass


class StrictLoader(yaml.SafeLoader): pass


def mapping(loader,node,deep=False):
    result={}
    for key_node,value_node in node.value:
        key=loader.construct_object(key_node,deep=deep)
        if not isinstance(key,str) or key in result: raise RegistryError('duplicate/non-string registry key')
        result[key]=loader.construct_object(value_node,deep=deep)
    return result


StrictLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,mapping)


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()


def finite(value):
    if type(value) not in (int,float): return False
    try: return math.isfinite(value)
    except OverflowError: return False


def property_value(descriptor,value):
    kind=descriptor['type']
    if kind in ('integer','duration'):
        valid=type(value) is int
    elif kind=='number': valid=finite(value)
    elif kind=='boolean': valid=type(value) is bool
    elif kind in ('string','expression','rss-path'):
        valid=isinstance(value,str) and len(value)<=16384
        if kind!='string': valid=valid and bool(value.strip()) and len(value)<=4096
    elif kind=='enum': valid=any(type(value) is type(item) and value==item for item in descriptor.get('values',[]))
    elif kind=='waypoints':
        valid=(isinstance(value,list) and 1<=len(value)<=20 and all(isinstance(point,list) and len(point)==2
            and all(finite(number) and abs(number)<=1000
                    for number in point) for point in value))
    else: valid=False
    if not valid: raise RegistryError('invalid '+kind+' property value')
    if type(value) in (int,float):
        if 'minimum' in descriptor and value<descriptor['minimum']: raise RegistryError('property below minimum')
        if 'maximum' in descriptor and value>descriptor['maximum']: raise RegistryError('property above maximum')
    return copy.deepcopy(value)


def normalize_properties(block,props):
    if not isinstance(props,dict) or set(props)-set(block['props']): raise RegistryError('unknown block properties')
    output={}
    for name,descriptor in block['props'].items():
        if name in props: value=props[name]
        elif 'default' in descriptor: value=descriptor['default']
        elif descriptor['required']: raise RegistryError('missing property '+name)
        else: continue
        try: output[name]=property_value(descriptor,value)
        except RegistryError as error: raise RegistryError(name+': '+str(error)) from error
    return output


class Registry:
    def __init__(self,records):
        self._bytes=canonical(sorted(records,key=lambda item:item['id']))
        self.hash='sha256:'+hashlib.sha256(self._bytes).hexdigest()

    @property
    def records(self): return json.loads(self._bytes)

    def get(self,identity):
        for item in self.records:
            if item['id']==identity: return item
        raise RegistryError('unknown block '+str(identity))

    def public(self):
        return {'schema':'block-registry.v1','registryHash':self.hash,'blocks':self.records}


def load_registry(directory=None,schema_path='/contracts/block.v1.json'):
    directory=Path(directory) if directory is not None else Path(__file__).parent/'blocks'
    files=sorted(directory.glob('*.block.yaml'))
    if not 1<=len(files)<=128: raise RegistryError('registry requires 1..128 block files')
    validator=Draft202012Validator(json.loads(Path(schema_path).read_text()))
    records=[]
    identities=set()
    for path in files:
        if path.is_symlink() or path.resolve().parent!=directory.resolve():
            raise RegistryError('registry file must stay inside its owned directory')
        if path.stat().st_size>65536: raise RegistryError('registry block exceeds 64 KiB')
        try:
            text=path.read_text()
            if any(isinstance(event,yaml.AliasEvent) for event in yaml.parse(text)):
                raise RegistryError('registry aliases are forbidden')
            block=yaml.load(text,Loader=StrictLoader)
            canonical(block)  # Nonfinite/non-JSON values cannot enter the registry.
            validator.validate(block)
            if block['id']!=path.name.removesuffix('.block.yaml'): raise RegistryError('registry filename/id mismatch')
            if block['id'] in identities: raise RegistryError('duplicate block identity')
            if (block['lowering'] not in LOWERINGS or block['version']!=1
                    or block['id']!='rf.'+block['lowering']):
                raise RegistryError('unknown lowering or block implementation version')
            expected_category=('trigger' if block['lowering'] in ('on_start','on_change','on_condition','every','on_event')
                else 'robot' if block['lowering'] in ('arm','disarm','stop','reset_stop','move','go_to','patrol','perform','cancel')
                else 'log' if block['lowering']=='log' else 'flow')
            if block['category']!=expected_category: raise RegistryError('block category/effect mismatch')
            for descriptor in block['props'].values():
                if descriptor.get('minimum',0)>descriptor.get('maximum',float('inf')):
                    raise RegistryError('inverted property bounds')
                if descriptor['type']=='enum':
                    values=descriptor.get('values',[])
                    if not values or len({canonical(value) for value in values})!=len(values):
                        raise RegistryError('empty/duplicate property enum')
                if 'default' in descriptor: property_value(descriptor,descriptor['default'])
            if block['category']=='robot':
                outputs=block['ports']['outputs']
                if (set(outputs)!=RESULTS or any(not port['required'] or port['role']!='result' for port in outputs.values())
                        or 'timeoutMs' not in block['props']):
                    raise RegistryError('robot block requires timeout and every result branch')
            if block['migrations']: raise RegistryError('v1 registry has no predecessor migration')
            normalize_properties(block,{})
        except (ValueError,TypeError,KeyError,ValidationError,yaml.YAMLError,RecursionError) as error:
            raise RegistryError(path.name+': '+str(error)[:500]) from error
        identities.add(block['id'])
        records.append(block)
    return Registry(records)

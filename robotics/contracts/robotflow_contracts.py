"""Deterministic schema source; emitted JSON is the versioned wire artifact.

No runtime implementation is shared through this module. Run this file only to
refresh the three checked-in JSON schemas, then validate the contract fixtures.
"""
import json
from pathlib import Path

HEADER={'$schema':'https://json-schema.org/draft/2020-12/schema'}
IDENT={'type':'string','pattern':r'^[A-Za-z_][A-Za-z0-9_-]{0,95}$'}
PROFILE={'type':'string','pattern':r'^[a-z][a-z0-9-]{0,95}$'}
HASH={'type':'string','pattern':r'^sha256:[a-f0-9]{64}$'}
PATH={'type':'string','pattern':r'^Robot(?:\.[A-Za-z][A-Za-z0-9]*)+$','maxLength':256}
TEXT={'type':'string','maxLength':16384}
MS={'type':'integer','minimum':1,'maximum':86400000}
TYPES=['bool','uint8','int32','uint32','int64','float32','float64','string','enum']


def obj(properties,required=None,**extra):
    return dict(type='object',properties=properties,required=list(properties) if required is None else required,
                additionalProperties=False,**extra)


def arr(items,minimum=0,maximum=2000):
    return dict(type='array',items=items,minItems=minimum,maxItems=maximum)


def ref(name): return {'$ref':'#/$defs/'+name}
def const(value): return {'const':value}
def enum(*values): return {'enum':list(values)}
def record(value,maximum=64):
    return dict(type='object',additionalProperties=value,maxProperties=maximum)


def common():
    json_value={'oneOf':[{'type':kind} for kind in ('null','boolean','number','string')]+[
        arr(ref('json')),record(ref('json'))]}
    variable={'oneOf':[
        obj({'type':const('bool'),'initial':{'type':'boolean'}}),
        obj({'type':const('string'),'initial':TEXT}),
        obj({'type':const('int32'),'initial':{'type':'integer','minimum':-(2**31),'maximum':2**31-1},'unit':TEXT},['type','initial']),
        obj({'type':const('float64'),'initial':{'type':'number'},'unit':TEXT},['type','initial'])]}
    return {'json':json_value,'variable':variable}


def workflow_schema():
    definitions=common()
    definitions['node']=obj({'id':IDENT,'block':{'type':'string','pattern':r'^rf\.[a-z][a-z0-9_]*$'},
        'v':{'type':'integer','minimum':1,'maximum':999},'props':record(ref('json')),
        'ui':obj({'x':{'type':'number'},'y':{'type':'number'}},['x','y'])},['id','block','v','props'])
    endpoint={'type':'array','prefixItems':[IDENT,IDENT],'items':False,'minItems':2,'maxItems':2}
    return dict(HEADER,**{'$id':'urn:robotflow:robotflow.v1','$defs':definitions},**obj({
        'schema':const('robotflow.v1'),'rss':obj({'version':const('0.1'),'catalogHash':HASH}),
        'profile':PROFILE,'vars':dict(record(ref('variable')),propertyNames=IDENT),
        'nodes':arr(ref('node'),1,1000),'edges':arr(obj({'from':endpoint,'to':endpoint}),0,5000)}))


def block_schema():
    definitions=common()
    localized=obj({'vi':dict(TEXT,minLength=1),'en':dict(TEXT,minLength=1)})
    definitions['prop']=obj({'type':enum('rss-path','expression','duration','number','integer','string','boolean','enum','waypoints'),
        'required':{'type':'boolean'},'default':ref('json'),'unit':TEXT,'minimum':{'type':'number'},
        'maximum':{'type':'number'},'values':arr(ref('json'),1,256),'kind':enum('sensor','attribute','setpoint','command'),
        'title':localized},['type','required'])
    port=obj({'required':{'type':'boolean'},'role':enum('in','next','body','branch','result','join'),
              'fanIn':{'type':'boolean'}},['required','role'])
    ports=lambda maximum:dict(record(port,maximum),propertyNames=IDENT)
    migration=obj({'from':{'type':'integer','minimum':1},'to':{'type':'integer','minimum':2},
        'renameProps':record(TEXT),'setDefaults':record(ref('json'))})
    return dict(HEADER,**{'$id':'urn:robotflow:block.v1','$defs':definitions},**obj({
        'schema':const('block.v1'),'id':{'type':'string','pattern':r'^rf\.[a-z][a-z0-9_]*$'},
        'version':{'type':'integer','minimum':1},'category':enum('trigger','robot','flow','log'),
        'title':localized,'ports':obj({'inputs':ports(1),'outputs':ports(16)}),
        'props':dict(record(ref('prop')),propertyNames=IDENT),'semantics':localized,
        'lowering':{'type':'string','pattern':r'^[a-z][a-z0-9_]*$'},'migrations':arr(migration,0,16)}))


def ir_schema():
    definitions=common()
    expression=[]
    for kind,value in [('bool',{'type':'boolean'}),('string',TEXT),('enum',TEXT),
        ('int32',{'type':'integer','minimum':-(2**31),'maximum':2**31-1}),
        ('uint8',{'type':'integer','minimum':0,'maximum':255}),
        ('uint32',{'type':'integer','minimum':0,'maximum':2**32-1}),
        ('int64',{'type':'integer','minimum':-(2**63),'maximum':2**63-1}),
        ('float32',{'type':'number'}),('float64',{'type':'number'})]:
        expression.append(obj({'kind':const('literal'),'type':const(kind),'value':value,'unit':TEXT},['kind','type','value']))
    for kind,field,definition in [('signal','path',PATH),('var','name',IDENT)]:
        expression.append(obj({'kind':const(kind),field:definition,'type':enum(*TYPES),'unit':TEXT},['kind',field,'type']))
    expression.extend([
        obj({'kind':const('unary'),'operator':enum('not','-','+'),'operand':ref('expr'),'type':enum(*TYPES),'unit':TEXT},
            ['kind','operator','operand','type']),
        obj({'kind':const('binary'),'operator':enum('+','-','*','/','==','!=','<','<=','>','>=','and','or'),
            'left':ref('expr'),'right':ref('expr'),'type':enum(*TYPES),'unit':TEXT},['kind','operator','left','right','type']),
        obj({'kind':const('call'),'name':enum('abs','min','max','clamp'),'args':arr(ref('expr'),1,3),
            'type':enum(*TYPES),'unit':TEXT},['kind','name','args','type'])])
    definitions['expr']={'oneOf':expression}
    definitions['src']=obj({'nodeId':IDENT})
    definitions['body']=arr(ref('statement'))
    definitions['results']=obj({phase:ref('body') for phase in ('succeeded','failed','rejected','cancelled','timed_out')})
    definitions['trigger']={'oneOf':[
        obj({'kind':const('start')}),obj({'kind':const('change'),'path':PATH}),
        obj({'kind':const('condition'),'condition':ref('expr'),'forMs':{'type':'integer','minimum':0,'maximum':86400000}}),
        obj({'kind':const('every'),'ms':dict(MS,minimum=10)}),obj({'kind':const('event'),'name':IDENT})]}
    def statement(op,fields=None): return obj({'op':const(op),'src':ref('src'),**(fields or {})})
    value=record(ref('expr'),32)
    statements=[statement('noop'),statement('log',{'level':enum('info','warn','error'),
        'parts':arr({'oneOf':[TEXT,ref('expr')]},1,256)}),
        statement('wait',{'ms':MS}),statement('wait_until',{'condition':ref('expr'),'timeoutMs':MS,
            'on':obj({'succeeded':ref('body'),'timed_out':ref('body')})}),
        statement('set_target',{'path':PATH,'value':value}),
        statement('hold',{'path':PATH,'value':value,'ms':MS,'timeoutMs':MS,'on':ref('results')}),
        statement('invoke',{'path':PATH,'args':value,'timeoutMs':MS,'on':ref('results')}),
        statement('cancel',{'scope':const('body'),'timeoutMs':MS,'on':ref('results')}),
        statement('stop',{'timeoutMs':MS,'on':ref('results')}),
        statement('if',{'condition':ref('expr'),'then':ref('body'),'else':ref('body')}),
        statement('loop',{'count':{'type':'integer','minimum':1,'maximum':1000},'body':ref('body')}),
        statement('loop',{'forever':const(True),'body':ref('body')}),
        statement('parallel',{'mode':enum('all','any'),'children':arr(ref('body'),2,8)}),
        statement('assign',{'name':IDENT,'value':ref('expr')}),statement('read',{'path':PATH,'name':IDENT})]
    definitions['statement']={'oneOf':statements}
    behavior=obj({'id':IDENT,'src':ref('src'),'trigger':ref('trigger'),
        'concurrency':enum('queue','drop','restart'),'queueMax':{'type':'integer','minimum':1,'maximum':16},'body':ref('body')})
    return dict(HEADER,**{'$id':'urn:robotflow:rfir.v1','$defs':definitions},**obj({
        'schema':const('rfir.v1'),'catalogHash':HASH,'profile':PROFILE,'profileHash':HASH,
        'runtimeVersion':const('0.1.0'),'vars':dict(record(ref('variable')),propertyNames=IDENT),
        'behaviors':arr(behavior,1,64),'irHash':HASH}))


def schemas():
    return {'robotflow.v1':workflow_schema(),'block.v1':block_schema(),'rfir.v1':ir_schema()}


if __name__=='__main__':
    for name,schema in schemas().items():
        (Path(__file__).parent/(name+'.json')).write_text(json.dumps(schema,sort_keys=True,indent=2,ensure_ascii=False)+'\n')

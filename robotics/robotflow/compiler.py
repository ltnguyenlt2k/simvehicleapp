"""Pure RobotFlow S0-S6 validation and deterministic typed IR construction."""
from collections import Counter,defaultdict
from functools import lru_cache
import hashlib
import heapq
import json
import math
from pathlib import Path
import re

from jsonschema import Draft202012Validator,ValidationError
from errors import ExprError,IRLimit
from expression import compile_expression,UNKNOWN,NUMERIC
from registry import RegistryError,load_registry,normalize_properties
from units import UnitRegistry,SCALAR,finite

RESULTS=('succeeded','failed','rejected','cancelled','timed_out')
BODY=frozenset(('arm','disarm','reset_stop','move','go_to','patrol','perform'))
MOTION=frozenset(('arm','move','go_to','patrol','perform'))
COMMANDS={'arm':'Robot.Safety.Arm','disarm':'Robot.Safety.Disarm','stop':'Robot.Safety.Stop',
    'reset_stop':'Robot.Safety.ResetStop','go_to':'Robot.Navigation.GoTo',
    'patrol':'Robot.Navigation.GoTo','perform':'Robot.Motion.Perform','move':'Robot.Motion.Velocity'}


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()


@lru_cache(maxsize=16)
def schema(name):return json.loads((Path('/contracts')/(name+'.json')).read_text())


def strict_pairs(pairs):
    value={}
    for key,item in pairs:
        if key in value:raise ValueError('duplicate JSON key '+key)
        value[key]=item
    return value


class Compiler:
    def __init__(self,source,catalog,profile,registry,units,mode):
        self.source,self.catalog,self.profile=source,catalog,profile
        self.registry,self.units,self.mode=registry,units,mode
        self.commands,self.results=COMMANDS,RESULTS
        self.blocks={item['id']:item for item in registry.records}
        self.diagnostics=[];self.nodes={};self.props={};self.links={};self.adj=defaultdict(list)
        self.expressions={};self.parts={};self.regions={};self.roots=[];self.var_types={}

    def add(self,code,node=None,field=None,**data):
        if len(self.diagnostics)>=200:return
        detail=schema('diagnostics.v1')['details'][code]
        self.diagnostics.append(dict(code=code,severity=detail['severity'],stage=detail['stage'],
            nodeId=node,field=field,data=data,message=dict(detail['message'])))

    def errors(self):return any(item['severity']=='error' for item in self.diagnostics)

    def result(self,ir=None):
        diagnostics=sorted(self.diagnostics,key=lambda item:(item['stage'],item['nodeId'] or '',item['code'],item['field'] or ''))
        return {'ok':not self.errors(),'diagnostics':diagnostics,'ir':ir if not self.errors() else None}

    def next(self,identity,port='next'):return self.links.get((identity,port))
    def kind(self,identity):return self.nodes[identity]['block'].removeprefix('rf.')

    def run(self):
        if self.mode not in ('lint','build'):
            self.add('RF1001',field='mode',detail='mode must be lint or build');return self.result()
        try:
            self.profile=json.loads(canonical(self.profile))
            Draft202012Validator(schema('robotflow-profile.v1')).validate(self.profile)
        except (ValueError,TypeError,RecursionError,ValidationError) as error:
            self.add('RF6003',field='profile',detail=str(error)[:500]);return self.result()
        for stage in (self.s0,self.s1,self.s2,self.s3,self.s4,self.s5,self.s6):
            try:stage()
            except ExprError as error:self.add(error.code,detail=error.detail[:500])
            except RecursionError:self.add('RF1002',detail='compiler structural depth limit')
            except (OverflowError,ZeroDivisionError):self.add('RF4005',detail='invalid interval arithmetic')
            if self.errors():return self.result()
        if self.mode=='lint':return self.result()
        from lowering import lower
        try:
            ir=lower(self)
            Draft202012Validator(schema('rfir.v1')).validate(ir)
        except (RecursionError,IRLimit) as error:
            self.add('RF1002',field='nodes',detail=str(error)[:500]);return self.result()
        except ValidationError as error:
            self.add('RF1002',field='nodes',detail='IR shape/budget: '+error.message[:450]);return self.result()
        return self.result(ir)

    def s0(self):
        try:
            if isinstance(self.source,(str,bytes)):
                raw=self.source.encode() if isinstance(self.source,str) else self.source
                if len(raw)>1024*1024:self.add('RF1002',detail='workflow exceeds 1 MiB');return
                self.graph=json.loads(raw,object_pairs_hook=strict_pairs,
                    parse_constant=lambda value:(_ for _ in ()).throw(ValueError('nonfinite JSON '+value)))
            else:
                raw=canonical(self.source)
                if len(raw)>1024*1024:self.add('RF1002',detail='workflow exceeds 1 MiB');return
                self.graph=json.loads(raw)
            stack=[(self.graph,0)];count=0
            while stack:
                value,depth=stack.pop();count+=1
                if depth>64 or count>100000:self.add('RF1002',detail='workflow nesting/value limit');return
                if type(value) is float and not math.isfinite(value):raise ValueError('nonfinite JSON')
                if isinstance(value,dict):stack.extend((child,depth+1) for child in value.values())
                elif isinstance(value,list):stack.extend((child,depth+1) for child in value)
            if isinstance(self.graph,dict):
                if isinstance(self.graph.get('nodes'),list) and len(self.graph['nodes'])>self.profile['limits']['maxNodes']:
                    self.add('RF1002',field='nodes',detail='node budget exceeded');return
                if isinstance(self.graph.get('edges'),list) and len(self.graph['edges'])>5000:
                    self.add('RF1002',field='edges',detail='edge budget exceeded');return
            Draft202012Validator(schema('robotflow.v1')).validate(self.graph)
        except RecursionError:
            self.add('RF1002',detail='workflow nesting limit')
        except (ValueError,TypeError,UnicodeError,ValidationError) as error:
            self.add('RF1001',detail=str(error)[:500])

    def s1(self):
        for item in self.graph['nodes']:
            if item['id'] in self.nodes:self.add('RF1003',item['id'],field='id')
            self.nodes[item['id']]=item
        if self.errors():return
        incoming=Counter();indegree=Counter({identity:0 for identity in self.nodes})
        for item in self.graph['edges']:
            source,port=item['from'];target,input_port=item['to']
            if source not in self.nodes or target not in self.nodes:
                self.add('RF1004',source,field='edges',source=item['from'],target=item['to']);continue
            source_block=self.blocks.get(self.nodes[source]['block']);target_block=self.blocks.get(self.nodes[target]['block'])
            if source_block and self.nodes[source]['v']==source_block['version'] and port not in source_block['ports']['outputs']:
                self.add('RF1005',source,field='edges',port=port,direction='output')
            if target_block and self.nodes[target]['v']==target_block['version']:
                descriptor=target_block['ports']['inputs'].get(input_port)
                if descriptor is None:self.add('RF1005',target,field='edges',port=input_port,direction='input')
                incoming[(target,input_port)]+=1
                if descriptor and incoming[(target,input_port)]>1 and not descriptor.get('fanIn',False):
                    self.add('RF1005',target,field='edges',detail='input requires an explicit Join')
            if (source,port) in self.links:self.add('RF1006',source,field='edges',port=port)
            self.links[(source,port)]=target
            self.adj[source].append(target);indegree[target]+=1
        queue=[identity for identity,number in indegree.items() if number==0];heapq.heapify(queue)
        visited=0;self.order=[]
        while queue:
            identity=heapq.heappop(queue);visited+=1
            self.order.append(identity)
            for target in self.adj[identity]:
                indegree[target]-=1
                if not indegree[target]:heapq.heappush(queue,target)
        if visited!=len(self.nodes):self.add('RF1007',field='edges')

    def s2(self):
        for identity,item in sorted(self.nodes.items()):
            block=self.blocks.get(item['block'])
            if block is None:self.add('RF2001',identity,field='block');continue
            if item['v']!=block['version']:self.add('RF2002',identity,field='v',version=item['v']);continue
            try:self.props[identity]=normalize_properties(block,item['props'])
            except RegistryError as error:self.add('RF2003',identity,field='props',detail=str(error));continue
            if block['lowering']=='on_event' and not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_-]{0,95}',self.props[identity]['name']):
                self.add('RF2003',identity,field='name',detail='invalid event identity')
        reserved={'Robot','true','false','and','or','not','abs','min','max','clamp'}
        for name in self.graph['vars']:
            if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,95}',name) or name in reserved:
                self.add('RF2003',field='vars.'+name,detail='invalid/reserved variable name')

    def s3(self):
        try:
            Draft202012Validator(schema('rss-catalog.v1')).validate(self.catalog)
            content={key:value for key,value in self.catalog.items() if key!='catalogHash'}
            digest='sha256:'+hashlib.sha256(canonical(content)).hexdigest()
            if (digest!=self.catalog['catalogHash'] or digest!=self.graph['rss']['catalogHash']
                    or digest!=self.profile['catalogHash']):
                self.add('RF3001',field='rss.catalogHash',expected=digest);return
        except (ValueError,TypeError,ValidationError) as error:
            self.add('RF3001',field='rss',detail=str(error)[:500]);return
        for identity,item in sorted(self.nodes.items()):
            block=self.blocks[item['block']];props=self.props[identity]
            paths=[(field,props[field],descriptor.get('kind')) for field,descriptor in block['props'].items()
                   if descriptor['type']=='rss-path' and field in props]
            kind=block['lowering']
            if kind in COMMANDS:paths.append(('block',COMMANDS[kind],'setpoint' if kind=='move' else 'command'))
            for field,path,expected in paths:
                declaration=self.catalog['nodes'].get(path)
                if declaration is None:self.add('RF3002',identity,field=field,path=path)
                elif (expected and declaration['kind']!=expected or not expected and declaration['kind'] not in ('sensor','attribute')):
                    self.add('RF3003',identity,field=field,path=path,expected=expected or 'readable')
            if kind=='move' and COMMANDS[kind] in self.catalog['nodes']:
                if set(self.catalog['nodes'][COMMANDS[kind]].get('fields',{}))!={'LinearX','AngularZ'}:
                    self.add('RF3003',identity,field='block',detail='complete velocity structure required')
            if kind in COMMANDS and kind!='move' and COMMANDS[kind] in self.catalog['nodes']:
                expected={'go_to':{'X','Y'},'patrol':{'X','Y'},'perform':{'Name'}}.get(kind,set())
                if set(self.catalog['nodes'][COMMANDS[kind]].get('args',{}))!=expected:
                    self.add('RF3003',identity,field='block',detail='command argument structure mismatch')

    def expression(self,identity,field,source,expected=None,unit=None):
        try:
            expression=compile_expression(source,self.catalog,self.graph['vars'],self.units)
            if expected=='number' and expression.kind not in NUMERIC:raise ExprError('RF4002','numeric expression required')
            if expected=='bool' and expression.kind!='bool':raise ExprError('RF4002','boolean condition required')
            if unit is not None and expression.dimension!=self.units.dimension(unit):raise ExprError('RF4003','property unit mismatch')
            self.expressions[(identity,field)]=expression
            return expression
        except ExprError as error:
            self.add(error.code,identity,field=field,detail=error.detail[:500],position=error.position)

    def assignment(self,identity,field,name,expression):
        declaration=self.graph['vars'].get(name)
        if declaration is None:self.add('RF4004',identity,field=field,detail='undeclared variable '+name);return
        if expression is None:return
        target=declaration['type'];actual=expression.kind
        if target in NUMERIC and actual in NUMERIC:
            if expression.dimension!=self.units.dimension(declaration.get('unit','1')):
                self.add('RF4003',identity,field=field,detail='variable dimension mismatch');return
            valid=(target=='float64' and (actual!='int64' or expression.constant is not UNKNOWN
                and int(float(expression.constant))==expression.constant)
                or target=='int32' and actual in ('int32','uint8'))
        else:valid=target==actual or target=='string' and actual=='enum'
        if not valid:self.add('RF4002',identity,field=field,detail='variable assignment type mismatch')

    def log_parts(self,identity,message):
        output=[];text=[];index=0;holes=0
        while index<len(message):
            if message.startswith('{{',index):text.append('{');index+=2;continue
            if message.startswith('}}',index):text.append('}');index+=2;continue
            if message[index]=='{':
                end=message.find('}',index+1)
                if end<0:self.add('RF4001',identity,field='message',detail='unterminated interpolation');return []
                holes+=1
                if holes>32:self.add('RF1002',identity,field='message',detail='interpolation count limit');return []
                if text:output.append(''.join(text));text=[]
                expression=self.expression(identity,'message',message[index+1:end])
                if expression:output.append(expression.ast)
                index=end+1
            elif message[index]=='}':
                self.add('RF4001',identity,field='message',detail='unmatched interpolation brace');return []
            else:text.append(message[index]);index+=1
        if text:output.append(''.join(text))
        return output or ['']

    def s4(self):
        for name,declaration in self.graph['vars'].items():
            try:
                kind=declaration['type'];value=declaration['initial']
                if kind in NUMERIC:
                    _,scale,offset=self.units.info(declaration.get('unit','1'))
                    self.units.to_base(value,declaration.get('unit','1'))
                    if kind=='int32' and (type(value) is not int or scale!=1 or offset):
                        raise ExprError('RF4003' if scale!=1 or offset else 'RF4002','integer variable needs integral identity-scale storage')
                elif declaration.get('unit'):raise ExprError('RF4003','nonnumeric variable has units')
            except ExprError as error:self.add(error.code,field='vars.'+name,detail=error.detail)
        if self.errors():return
        for identity in sorted(self.nodes):
            kind=self.kind(identity);props=self.props[identity]
            if kind in ('if','on_condition','wait_until'):self.expression(identity,'when',props['when'],'bool')
            elif kind=='move':
                self.expression(identity,'linear',props['linear'],'number','m/s')
                self.expression(identity,'angular',props['angular'],'number','rad/s')
            elif kind=='go_to':
                self.expression(identity,'x',props['x'],'number','m');self.expression(identity,'y',props['y'],'number','m')
            elif kind=='assign':self.assignment(identity,'value',props['name'],self.expression(identity,'value',props['value']))
            elif kind=='read':self.assignment(identity,'name',props['name'],self.expression(identity,'path',props['path']))
            elif kind=='log':self.parts[identity]=self.log_parts(identity,props['message'])
            elif kind=='perform':
                declaration=self.catalog['nodes'][COMMANDS[kind]]['args']['Name']
                if declaration['type']!='enum' or props['name'] not in declaration.get('values',[]):
                    self.add('RF4002',identity,field='name',detail='motion is not in the commissioned command enum')

    def reach(self,start):
        pending=[start] if start is not None else [];seen=set()
        while pending:
            identity=pending.pop()
            if identity in seen:continue
            seen.add(identity);pending.extend(self.adj[identity])
        return seen

    def writes(self,identities):
        return {self.props[identity]['name'] for identity in identities if self.kind(identity) in ('assign','read')}

    def yielding(self,identity):
        # Reverse DAG order avoids Python recursion for long ordinary chains.
        # WaitUntil can be immediately true, so it is not a guaranteed delay.
        if not hasattr(self,'yield_memo'):
            memo={None:False}
            for item in reversed(self.order):
                kind=self.kind(item)
                if kind in BODY|{'stop','cancel','wait'}:result=True
                elif kind=='end':result=False
                elif kind=='loop':result=memo[self.next(item,'body')] or memo[self.next(item,'done')]
                elif kind=='parallel':
                    children=[memo[self.next(item,port)] for port in ('branch1','branch2')]
                    result=(all(children) if self.props[item]['mode']=='any' else any(children)) or memo[self.next(item,'done')]
                else:
                    children=self.adj[item];result=bool(children) and all(memo[child] for child in children)
                memo[item]=result
            self.yield_memo=memo
        return self.yield_memo.get(identity,False)

    def s5(self):
        self.roots=sorted(identity for identity,item in self.nodes.items() if self.blocks[item['block']]['category']=='trigger')
        reachable=set().union(*(self.reach(root) for root in self.roots)) if self.roots else set()
        for identity in sorted(set(self.nodes)-reachable):self.add('RF5001',identity,field='nodes')
        for identity in sorted(reachable):
            for port,descriptor in self.blocks[self.nodes[identity]['block']]['ports']['outputs'].items():
                if descriptor['required'] and self.next(identity,port) is None:self.add('RF5002',identity,field=port)
        if self.errors():return
        for identity in sorted(reachable):
            kind=self.kind(identity)
            if kind not in ('loop','parallel'):continue
            outer=self.reach(self.next(identity,'done'))
            ports=('body',) if kind=='loop' else ('branch1','branch2')
            children=[self.reach(self.next(identity,port)) for port in ports]
            if any(region&outer for region in children) or len(children)==2 and children[0]&children[1]:
                self.add('RF5003',identity,field='ports',detail='isolated child region overlaps sibling/continuation')
            self.regions[identity]=children
            if kind=='loop' and self.props[identity]['forever']:
                try:valid=self.yielding(self.next(identity,'body'))
                except RecursionError:valid=False
                if not valid:self.add('RF5004',identity,field='body')
            if kind=='parallel' and self.writes(children[0])&self.writes(children[1]):
                self.add('RF5005',identity,field='branches')
        root_writes=[self.writes(self.reach(root)) for root in self.roots]
        for index,left in enumerate(root_writes):
            for right in root_writes[index+1:]:
                if left&right:self.add('RF5005',field='vars',variables=sorted(left&right))

    def bounds(self,ast):
        unknown=(-math.inf,math.inf);kind=ast['kind']
        if kind=='literal' and ast['type'] in NUMERIC:return (ast['value'],ast['value'])
        if kind=='signal':
            declaration=self.catalog['nodes'][ast['path']]
            if 'min' in declaration and 'max' in declaration:
                return tuple(self.units.to_base(declaration[key],declaration.get('unit','1')) for key in ('min','max'))
            return unknown
        if kind=='var':return unknown
        if kind=='unary':
            low,high=self.bounds(ast['operand']);return (-high,-low) if ast['operator']=='-' else (low,high)
        if kind=='call':
            intervals=[self.bounds(item) for item in ast['args']]
            if ast['name']=='clamp':return (intervals[1][0],intervals[2][1])
            if ast['name']=='min':return (min(item[0] for item in intervals),min(item[1] for item in intervals))
            if ast['name']=='max':return (max(item[0] for item in intervals),max(item[1] for item in intervals))
            low,high=intervals[0];return (0 if low<=0<=high else min(abs(low),abs(high)),max(abs(low),abs(high)))
        if kind=='binary':
            a,b=self.bounds(ast['left']);c,d=self.bounds(ast['right']);operator=ast['operator']
            if operator=='+':result=(a+c,b+d)
            elif operator=='-':result=(a-d,b-c)
            elif operator=='*':
                values=[a*c,a*d,b*c,b*d]
                if any(not self.endpoint(value) for value in values):return unknown
                result=(min(values),max(values))
            elif operator=='/' and not c<=0<=d:
                values=[a/c,a/d,b/c,b/d];result=(min(values),max(values))
            else:return unknown
            return unknown if any(not self.endpoint(value) for value in result) else result
        return unknown

    @staticmethod
    def endpoint(value):
        try:return not math.isnan(value)
        except (OverflowError,TypeError):return False

    def s6(self):
        limits=self.profile['limits']
        if self.graph['profile']!=self.profile['id']:self.add('RF6003',field='profile',detail='unapproved target profile')
        has_motion=any(self.kind(identity) in MOTION for identity in self.nodes)
        if has_motion and not any(self.kind(identity)=='stop' for identity in self.nodes):self.add('RF6004',field='nodes')
        for identity in sorted(self.nodes):
            kind=self.kind(identity);props=self.props[identity]
            if kind=='arm' and not self.profile['allowRemoteArm']:self.add('RF6003',identity,field='block')
            if kind=='move':
                for field,name in (('linear','LinearX'),('angular','AngularZ')):
                    low,high=self.bounds(self.expressions[(identity,field)].ast)
                    declaration=self.catalog['nodes'][COMMANDS[kind]]['fields'][name]
                    minimum=self.units.to_base(declaration['min'],declaration.get('unit','1'))
                    maximum=self.units.to_base(declaration['max'],declaration.get('unit','1'))
                    if not finite(low) or not finite(high) or low<minimum or high>maximum:
                        self.add('RF6001',identity,field=field,detail='speed needs proven bounds, e.g. clamp')
                if props['durationMs']>limits['maxMoveMs']:self.add('RF6002',identity,field='durationMs')
                if props['timeoutMs']<=props['durationMs']:self.add('RF6005',identity,field='timeoutMs',detail='timeout must include safe release')
            if kind in ('wait','wait_until'):
                field='durationMs' if kind=='wait' else 'timeoutMs'
                if props[field]>limits['maxWaitMs']:self.add('RF6002',identity,field=field)
            if kind in COMMANDS and kind!='move':
                maximum=min(limits['maxCommandMs'],self.catalog['nodes'][COMMANDS[kind]]['timeoutMs'])
                if props['timeoutMs']>maximum:self.add('RF6005',identity,field='timeoutMs')
            elif 'timeoutMs' in props and kind in BODY|{'cancel'}:
                if props['timeoutMs']>limits['maxCommandMs']:self.add('RF6005',identity,field='timeoutMs')
            if kind in ('go_to','patrol'):
                bound=self.profile['navigation']['maxAbsCoordinateM']
                if kind=='go_to':intervals=[self.bounds(self.expressions[(identity,field)].ast) for field in ('x','y')]
                else:intervals=[(value,value) for point in props['waypoints'] for value in point]
                if any(not finite(low) or not finite(high) or low<-bound or high>bound for low,high in intervals):
                    self.add('RF6008',identity,field='x/y' if kind=='go_to' else 'waypoints')
                if kind=='patrol' and len(props['waypoints'])*props['count']>limits['maxPatrolPoints']:
                    self.add('RF6007',identity,field='count')
            if kind=='loop' and not props['forever'] and props['count']>limits['maxLoopCount']:
                self.add('RF5003',identity,field='count',detail='loop count exceeds commissioned policy')
            if kind=='parallel':
                owners=[any(self.kind(item) in BODY for item in region) for region in self.regions[identity]]
                if sum(owners)>1:self.add('RF6006',identity,field='branches')


def compile_workflow(source,catalog,profile,registry=None,mode='build',units=None):
    compiler=Compiler(source,catalog,profile,registry or load_registry(),units or UnitRegistry(),mode)
    return compiler.run()

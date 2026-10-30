"""Validated graph -> structured typed IR; no source generation or side effects."""
import copy
import hashlib
import json

from errors import IRLimit


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()


class Lowerer:
    def __init__(self,session):
        self.s=session
        self.count=0
        self.depth=0
        self.bytes=0

    def statement(self,identity,op,**fields):
        self.count+=1
        if self.count>20000:raise IRLimit('expanded IR exceeds 20000 instructions')
        # Count each statement's own payload once, before a duplicated shared
        # tail can allocate an oversized final JSON string. Child statements
        # already account for their own bodies and outcome continuations.
        self.bytes+=len(canonical(dict(op=op,src={'nodeId':identity},
            **{key:value for key,value in fields.items() if key not in ('on','body','children','then','else')})))
        if self.bytes>2*1024*1024:raise IRLimit('expanded IR exceeds 2 MiB payload budget')
        return dict(op=op,src={'nodeId':identity},**fields)

    def expr(self,identity,field):return copy.deepcopy(self.s.expressions[(identity,field)].ast)
    def outcomes(self,identity):return {phase:self.body(self.s.next(identity,phase)) for phase in self.s.results}

    def patrol(self,identity,index,points):
        if index==len(points):return self.body(self.s.next(identity,'succeeded'))
        props=self.s.props[identity]
        args={field:{'kind':'literal','type':'float64','unit':'m','value':float(value)}
              for field,value in zip(('X','Y'),points[index])}
        outcomes={phase:self.body(self.s.next(identity,phase)) for phase in self.s.results if phase!='succeeded'}
        outcomes['succeeded']=self.patrol(identity,index+1,points)
        return [self.statement(identity,'invoke',path=self.s.commands['go_to'],args=args,
                    timeoutMs=props['timeoutMs'],on=outcomes)]

    def body(self,identity):
        self.depth+=1
        if self.depth>64:raise IRLimit('expanded control nesting exceeds 64')
        try:
            result=[]
            while identity is not None:
                kind=self.s.kind(identity);props=self.s.props[identity]
                if kind in ('join','end'):
                    result.append(self.statement(identity,'noop'))
                    if kind=='end':return result
                elif kind=='log':result.append(self.statement(identity,'log',level=props['level'],parts=copy.deepcopy(self.s.parts[identity])))
                elif kind=='wait':result.append(self.statement(identity,'wait',ms=props['durationMs']))
                elif kind=='assign':result.append(self.statement(identity,'assign',name=props['name'],value=self.expr(identity,'value')))
                elif kind=='read':result.append(self.statement(identity,'read',name=props['name'],path=props['path']))
                elif kind=='if':
                    result.append(self.statement(identity,'if',condition=self.expr(identity,'when'),
                        then=self.body(self.s.next(identity,'then')),**{'else':self.body(self.s.next(identity,'else'))}))
                    return result
                elif kind=='wait_until':
                    result.append(self.statement(identity,'wait_until',condition=self.expr(identity,'when'),timeoutMs=props['timeoutMs'],
                        on={phase:self.body(self.s.next(identity,phase)) for phase in ('succeeded','timed_out')}))
                    return result
                elif kind=='loop':
                    fields={'forever':True} if props['forever'] else {'count':props['count']}
                    result.append(self.statement(identity,'loop',body=self.body(self.s.next(identity,'body')),**fields))
                    identity=self.s.next(identity,'done');continue
                elif kind=='parallel':
                    result.append(self.statement(identity,'parallel',mode=props['mode'],
                        children=[self.body(self.s.next(identity,port)) for port in ('branch1','branch2')]))
                    identity=self.s.next(identity,'done');continue
                elif kind=='move':
                    result.append(self.statement(identity,'hold',path=self.s.commands['move'],
                        value={'LinearX':self.expr(identity,'linear'),'AngularZ':self.expr(identity,'angular')},
                        ms=props['durationMs'],timeoutMs=props['timeoutMs'],on=self.outcomes(identity)))
                    return result
                elif kind in ('cancel','stop'):
                    fields={'scope':'body'} if kind=='cancel' else {}
                    result.append(self.statement(identity,kind,timeoutMs=props['timeoutMs'],on=self.outcomes(identity),**fields))
                    return result
                elif kind=='patrol':
                    result.extend(self.patrol(identity,0,props['waypoints']*props['count']))
                    return result
                elif kind in ('arm','disarm','reset_stop','go_to','perform'):
                    args={}
                    if kind=='go_to':args={'X':self.expr(identity,'x'),'Y':self.expr(identity,'y')}
                    elif kind=='perform':args={'Name':{'kind':'literal','type':'enum','value':props['name']}}
                    result.append(self.statement(identity,'invoke',path=self.s.commands[kind],args=args,
                        timeoutMs=props['timeoutMs'],on=self.outcomes(identity)))
                    return result
                else:raise IRLimit('unexpected statement lowering '+kind)
                identity=self.s.next(identity)
            return result
        finally:self.depth-=1


def lower(session):
    builder=Lowerer(session)
    behaviors=[]
    for identity in session.roots:
        kind=session.kind(identity);props=session.props[identity]
        if kind=='on_start':trigger={'kind':'start'}
        elif kind=='on_change':trigger={'kind':'change','path':props['path']}
        elif kind=='on_condition':trigger={'kind':'condition','condition':builder.expr(identity,'when'),'forMs':props['forMs']}
        elif kind=='every':trigger={'kind':'every','ms':props['intervalMs']}
        elif kind=='on_event':trigger={'kind':'event','name':props['name']}
        else:raise IRLimit('unknown trigger lowering')
        behaviors.append(dict(id=identity,src={'nodeId':identity},trigger=trigger,
            concurrency=props['concurrency'],queueMax=props['queueMax'],body=builder.body(session.next(identity))))
    ir=dict(schema='rfir.v1',catalogHash=session.catalog['catalogHash'],profile=session.profile['id'],
        profileHash='sha256:'+hashlib.sha256(canonical(session.profile)).hexdigest(),unitsHash=session.units.hash,
        runtimeVersion='0.1.0',vars=copy.deepcopy(session.graph['vars']),behaviors=behaviors)
    payload=canonical(ir)
    if len(payload)>2*1024*1024:raise IRLimit('expanded IR exceeds 2 MiB')
    ir['irHash']='sha256:'+hashlib.sha256(payload).hexdigest()
    return ir

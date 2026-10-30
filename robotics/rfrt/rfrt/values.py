"""Closed typed AST evaluation over one refreshed snapshot; no source evaluation."""
from decimal import Decimal,localcontext
import math
import operator


class EvaluationError(ValueError):pass
class Unavailable(EvaluationError):pass


class _Unknown:
    def __bool__(self):raise Unavailable('unavailable value cannot become a boolean')


UNKNOWN=_Unknown()
LIMITS={'uint8':(0,255),'int32':(-2**31,2**31-1),'uint32':(0,2**32-1),'int64':(-2**63,2**63-1)}
NUMERIC=frozenset(LIMITS)|{'float32','float64'}
OPS={'+':operator.add,'-':operator.sub,'*':operator.mul,'/':operator.truediv,
     '==':operator.eq,'!=':operator.ne,'<':operator.lt,'<=':operator.le,'>':operator.gt,'>=':operator.ge}


def checked(value,spec):
    kind=spec['type']
    if value is UNKNOWN:return value
    if kind=='bool':valid=type(value) is bool
    elif kind in ('string','enum'):
        valid=isinstance(value,str) and len(value)<=16384 and (kind!='enum' or value in spec.get('values',[value]))
    elif kind in LIMITS:valid=type(value) is int and LIMITS[kind][0]<=value<=LIMITS[kind][1]
    elif kind in ('float32','float64'):
        try:valid=type(value) in (int,float) and math.isfinite(value) and (kind!='float32' or abs(value)<=3.4028234663852886e38)
        except OverflowError:valid=False
    else:valid=False
    if not valid:raise EvaluationError('invalid '+kind+' value')
    return value


class Values:
    def __init__(self,catalog,variables,units):
        self.catalog=catalog['nodes'];self.declarations=variables;self.units=units['units']
        self.variables={name:checked(spec['initial'],spec) for name,spec in variables.items()}

    def convert(self,value,symbol,inverse=False):
        if value is UNKNOWN:return value
        spec=self.units[symbol or '1'];scale=spec['scale'];offset=spec.get('offset',0)
        if scale==1 and offset==0:return value
        with localcontext() as context:
            context.prec=50
            number=Decimal(str(value));factor=Decimal(str(scale));shift=Decimal(str(offset))
            result=float((number-shift)/factor if inverse else number*factor+shift)
        return checked(result,{'type':'float64'})

    def source(self,value,spec):
        value=checked(value,spec)
        return self.convert(value,spec.get('unit','1')) if spec['type'] in NUMERIC else value

    def assign(self,name,base_value):
        declaration=self.declarations[name]
        value=(self.convert(base_value,declaration.get('unit','1'),True)
            if declaration['type'] in NUMERIC else base_value)
        if value is UNKNOWN:raise Unavailable('cannot assign unavailable value')
        self.variables[name]=checked(value,declaration)

    def evaluate(self,node,snapshot,depth=0):
        if depth>64:raise EvaluationError('expression depth exceeded')
        kind=node['kind']
        child=lambda item:self.evaluate(item,snapshot,depth+1)
        if kind=='literal':result=node['value'] # Compiler already normalized literal units.
        elif kind=='signal':result=self.source(snapshot.get(node['path'],UNKNOWN),self.catalog[node['path']])
        elif kind=='var':result=self.source(self.variables[node['name']],self.declarations[node['name']])
        elif kind=='unary':
            value=child(node['operand'])
            if value is UNKNOWN:return UNKNOWN
            op=node['operator']
            if op=='not':result=not checked(value,{'type':'bool'})
            elif op=='-':result=-value
            elif op=='+':result=+value
            else:raise EvaluationError('unknown unary operator')
        elif kind=='binary':
            op=node['operator'];left=child(node['left'])
            if op in ('and','or'):
                if left is not UNKNOWN:checked(left,{'type':'bool'})
                if op=='and' and left is False:return False
                if op=='or' and left is True:return True
                right=child(node['right'])
                if right is not UNKNOWN:checked(right,{'type':'bool'})
                if op=='and' and right is False:return False
                if op=='or' and right is True:return True
                if left is UNKNOWN or right is UNKNOWN:return UNKNOWN
                result=right
            else:
                right=child(node['right'])
                if left is UNKNOWN or right is UNKNOWN:return UNKNOWN
                if op not in OPS:raise EvaluationError('unknown binary operator')
                try:result=OPS[op](left,right)
                except (ZeroDivisionError,OverflowError,TypeError) as error:raise EvaluationError('invalid arithmetic') from error
        elif kind=='call':
            args=[child(item) for item in node['args']]
            if any(value is UNKNOWN for value in args):return UNKNOWN
            name=node['name']
            if name=='abs' and len(args)==1:result=abs(args[0])
            elif name=='min' and len(args) in (2,3):result=min(args)
            elif name=='max' and len(args) in (2,3):result=max(args)
            elif name=='clamp' and len(args)==3:
                if args[1]>args[2]:raise EvaluationError('inverted clamp bounds')
                result=min(max(args[0],args[1]),args[2])
            else:raise EvaluationError('unknown function or arity')
        else:raise EvaluationError('unknown AST kind')
        return checked(result,node)

    def condition(self,node,snapshot):
        value=self.evaluate(node,snapshot)
        if value is UNKNOWN:raise Unavailable('condition requires fresh data')
        return checked(value,{'type':'bool'})

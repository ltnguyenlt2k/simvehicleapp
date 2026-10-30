"""Bounded handwritten Pratt parser and typed dimensional expression compiler."""
from dataclasses import dataclass
import json
import re

from errors import ExprError
from units import SCALAR,TEMPERATURE,UnitRegistry,finite

UNKNOWN=object()
NUMERIC=frozenset(('uint8','int32','uint32','int64','float32','float64'))
COMPARISONS=frozenset(('==','!=','<','<=','>','>='))
BINDING={'or':10,'and':20,'==':30,'!=':30,'<':30,'<=':30,'>':30,'>=':30,
         '+':40,'-':40,'*':50,'/':50}
NUMBER=re.compile(r'(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?')
IDENTIFIER=re.compile(r'[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*')
LIMITS={'uint8':(0,255),'int32':(-(2**31),2**31-1),'uint32':(0,2**32-1),
        'int64':(-(2**63),2**63-1)}


@dataclass(frozen=True)
class Token:
    kind:str
    value:object
    position:int


@dataclass(frozen=True)
class Expression:
    ast:dict
    kind:str
    dimension:object
    constant:object=UNKNOWN
    paths:tuple=()
    depth:int=1


def tokenize(source,units):
    if not isinstance(source,str) or not source.strip() or len(source)>4096:
        raise ExprError('RF4001','expression requires 1..4096 characters')
    result=[]
    index=0
    decoder=json.JSONDecoder()
    while index<len(source):
        if source[index].isspace():index+=1;continue
        start=index
        match=NUMBER.match(source,index)
        if match:
            raw=match.group();index=match.end()
            cursor=index
            while cursor<len(source) and source[cursor].isspace():cursor+=1
            symbol='1'
            for candidate in units.symbols:
                end=cursor+len(candidate)
                if (source.startswith(candidate,cursor) and (end==len(source)
                        or not (source[end].isalnum() or source[end] in '_.'))):
                    symbol=candidate;index=end;break
            if symbol=='1' and cursor>index and cursor<len(source) and source[cursor].isalpha():
                following=IDENTIFIER.match(source,cursor)
                if following and following.group() not in ('and','or','not'):
                    raise ExprError('RF4003','unknown unit '+following.group(),cursor)
            result.append(Token('number',(raw,symbol),start))
        elif source[index]=='"':
            try:value,length=decoder.raw_decode(source[index:])
            except ValueError as error:raise ExprError('RF4001','invalid quoted string',index) from error
            result.append(Token('string',value,index));index+=length
        else:
            match=IDENTIFIER.match(source,index)
            if match:
                value=match.group();index=match.end()
                result.append(Token(value if value in ('and','or','not','true','false') else 'identifier',value,start))
            elif source[index:index+2] in ('==','!=','<=','>='):
                result.append(Token(source[index:index+2],source[index:index+2],index));index+=2
            elif source[index] in '+-*/<>() ,':
                result.append(Token(source[index],source[index],index));index+=1
            else:raise ExprError('RF4001','unexpected expression character',index)
        if len(result)>512:raise ExprError('RF4001','expression exceeds 512 tokens',start)
    result.append(Token('eof',None,len(source)))
    return result


class Parser:
    def __init__(self,source,catalog,variables,units):
        self.units,self.catalog,self.variables=units,catalog,variables
        self.tokens=tokenize(source,units)
        self.index=self.nodes=self.nesting=0

    def peek(self):return self.tokens[self.index]
    def take(self):
        token=self.peek();self.index+=1;return token
    def expect(self,kind):
        if self.peek().kind!=kind:raise ExprError('RF4001','expected '+kind,self.peek().position)
        return self.take()

    def node(self,ast,kind,dimension,constant=UNKNOWN,children=(),path=None):
        self.nodes+=1
        depth=1+max((child.depth for child in children),default=0)
        if self.nodes>512 or depth>64:raise ExprError('RF4001','expression AST limit exceeded')
        if constant is not UNKNOWN and kind in NUMERIC:
            if not finite(constant):raise ExprError('RF4005','nonfinite arithmetic result')
            if kind in LIMITS and (type(constant) is not int or not LIMITS[kind][0]<=constant<=LIMITS[kind][1]):
                raise ExprError('RF4005','integer arithmetic overflow')
        ast=dict(ast,type=kind)
        if dimension is not None:ast['unit']=self.units.canonical(dimension)
        paths=tuple(sorted({value for child in children for value in child.paths}|({path} if path else set())))
        return Expression(ast,kind,dimension,constant,paths,depth)

    def literal_number(self,token,sign=1):
        raw,symbol=token.value
        value=float(raw) if any(char in raw for char in '.eE') else int(raw)
        value*=sign
        if type(value) is int and not -(2**63)<=value<=2**63-1:
            raise ExprError('RF4005','integer literal outside int64',token.position)
        value=self.units.to_base(value,symbol)
        kind='float64' if type(value) is float else 'int32' if -(2**31)<=value<=2**31-1 else 'int64'
        return self.node({'kind':'literal','value':value},kind,self.units.dimension(symbol),value)

    def parse(self,minimum=0):
        self.nesting+=1
        if self.nesting>64:raise ExprError('RF4001','expression nesting exceeds 64')
        try:
            token=self.take()
            if token.kind=='number':left=self.literal_number(token)
            elif token.kind=='string':left=self.node({'kind':'literal','value':token.value},'string',None,token.value)
            elif token.kind in ('true','false'):
                value=token.kind=='true';left=self.node({'kind':'literal','value':value},'bool',None,value)
            elif token.kind=='(':
                left=self.parse();self.expect(')')
            elif token.kind in ('+','-','not'):
                if token.kind in ('+','-') and self.peek().kind=='number':
                    # Apply the literal sign before affine Celsius conversion.
                    left=self.literal_number(self.take(),-1 if token.kind=='-' else 1)
                else:left=self.unary(token.kind,self.parse(25 if token.kind=='not' else 60))
            elif token.kind=='identifier':left=self.identifier(token)
            else:raise ExprError('RF4001','expected expression operand',token.position)
            while self.peek().kind in BINDING and BINDING[self.peek().kind]>=minimum:
                operator=self.take().kind
                right=self.parse(BINDING[operator]+1)
                left=self.binary(operator,left,right)
            return left
        finally:self.nesting-=1

    def identifier(self,token):
        name=token.value
        if self.peek().kind=='(':
            if name not in ('abs','min','max','clamp'):raise ExprError('RF4004','unknown function '+name,token.position)
            self.take();arguments=[]
            if self.peek().kind!=')':
                while True:
                    arguments.append(self.parse())
                    if len(arguments)>3:raise ExprError('RF4002','function accepts at most three arguments')
                    if self.peek().kind!=',':break
                    self.take()
            self.expect(')')
            return self.call(name,arguments)
        if name.startswith('Robot.'):
            declaration=self.catalog['nodes'].get(name)
            if declaration is None:raise ExprError('RF3002','unknown RSS path '+name,token.position)
            if declaration['kind'] not in ('sensor','attribute'):raise ExprError('RF3003','RSS path is not readable',token.position)
            key='path';ast_kind='signal'
        else:
            declaration=self.variables.get(name)
            if declaration is None:raise ExprError('RF4004','unknown variable '+name,token.position)
            key='name';ast_kind='var'
        kind=declaration['type']
        if kind not in NUMERIC|{'bool','string','enum'}:raise ExprError('RF4002','unsupported source type')
        dimension=None
        if kind in NUMERIC:
            dimension,scale,offset=self.units.info(declaration.get('unit','1'))
            if scale!=1 or offset:kind='float64'
        elif declaration.get('unit'):raise ExprError('RF4003','nonnumeric source cannot have units')
        return self.node({'kind':ast_kind,key:name},kind,dimension,path=name if ast_kind=='signal' else None)

    def numeric(self,*nodes):
        if any(node.kind not in NUMERIC for node in nodes):raise ExprError('RF4002','numeric operands required')

    def compatible(self,*nodes):
        if any(node.dimension!=nodes[0].dimension for node in nodes):raise ExprError('RF4003','incompatible dimensions')

    def promote(self,*nodes):
        kinds={node.kind for node in nodes}
        return 'float64' if kinds&{'float32','float64'} else 'int64' if kinds&{'int64','uint32'} else 'int32'

    def unary(self,operator,operand):
        if operator=='not':
            if operand.kind!='bool':raise ExprError('RF4002','not requires boolean')
            kind,dimension='bool',None
            value=UNKNOWN if operand.constant is UNKNOWN else not operand.constant
        else:
            self.numeric(operand)
            if operand.dimension==TEMPERATURE:raise ExprError('RF4003','temperature arithmetic is not supported')
            kind=self.promote(operand);dimension=operand.dimension
            value=UNKNOWN if operand.constant is UNKNOWN else -operand.constant if operator=='-' else operand.constant
        return self.node({'kind':'unary','operator':operator,'operand':operand.ast},kind,dimension,value,(operand,))

    def binary(self,operator,left,right):
        known=left.constant is not UNKNOWN and right.constant is not UNKNOWN
        value=UNKNOWN
        if operator in ('and','or'):
            if left.kind!='bool' or right.kind!='bool':raise ExprError('RF4002','boolean operands required')
            kind,dimension='bool',None
            if left.constant is not UNKNOWN and ((operator=='and' and not left.constant) or (operator=='or' and left.constant)):
                value=left.constant
            elif known:value=(left.constant and right.constant) if operator=='and' else (left.constant or right.constant)
        elif operator in COMPARISONS:
            if left.kind in NUMERIC and right.kind in NUMERIC:self.compatible(left,right)
            elif (left.kind==right.kind=='bool' or left.kind in ('string','enum') and right.kind in ('string','enum')):
                if operator not in ('==','!='):raise ExprError('RF4002','only equality is defined for boolean/string')
            else:raise ExprError('RF4002','comparison type mismatch')
            kind,dimension='bool',None
            if known:
                a,b=left.constant,right.constant
                value={'==':a==b,'!=':a!=b,'<':a<b,'<=':a<=b,'>':a>b,'>=':a>=b}[operator]
        else:
            self.numeric(left,right)
            if TEMPERATURE in (left.dimension,right.dimension):raise ExprError('RF4003','temperature arithmetic is not supported')
            kind=self.promote(left,right)
            if operator in ('+','-'):
                self.compatible(left,right);dimension=left.dimension
            else:
                dimension=tuple(a+(b if operator=='*' else -b) for a,b in zip(left.dimension,right.dimension))
                if any(abs(power)>8 for power in dimension):raise ExprError('RF4003','derived dimension exceeds bounds')
            if operator=='/':
                kind='float64'
                if right.constant is not UNKNOWN and right.constant==0:raise ExprError('RF4005','division by zero')
            if known:
                a,b=left.constant,right.constant
                if operator=='+':value=a+b
                elif operator=='-':value=a-b
                elif operator=='*':value=a*b
                else:value=a/b
        return self.node({'kind':'binary','operator':operator,'left':left.ast,'right':right.ast},kind,dimension,value,(left,right))

    def call(self,name,arguments):
        count=len(arguments)
        if (name=='abs' and count!=1 or name in ('min','max') and count not in (2,3)
                or name=='clamp' and count!=3):raise ExprError('RF4002','invalid function arity')
        self.numeric(*arguments);self.compatible(*arguments)
        if name=='abs' and arguments[0].dimension==TEMPERATURE:raise ExprError('RF4003','abs temperature is not supported')
        if name=='clamp' and arguments[1].constant is not UNKNOWN and arguments[2].constant is not UNKNOWN:
            if arguments[1].constant>arguments[2].constant:raise ExprError('RF4005','clamp lower bound exceeds upper bound')
        value=UNKNOWN
        if all(argument.constant is not UNKNOWN for argument in arguments):
            values=[argument.constant for argument in arguments]
            if name=='abs':value=abs(values[0])
            elif name=='min':value=min(values)
            elif name=='max':value=max(values)
            else:value=min(values[2],max(values[1],values[0]))
        return self.node({'kind':'call','name':name,'args':[argument.ast for argument in arguments]},
            self.promote(*arguments),arguments[0].dimension,value,tuple(arguments))


def compile_expression(source,catalog,variables=None,units=None):
    parser=Parser(source,catalog,variables or {},units or UnitRegistry())
    expression=parser.parse()
    parser.expect('eof')
    return expression

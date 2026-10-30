"""Compiler-owned dimensional arithmetic over the shared data-only unit artifact."""
import hashlib
from decimal import Decimal,localcontext
import json
import math
from pathlib import Path

from errors import ExprError

SCALAR=(0,0,0,0,0,0)
TEMPERATURE=(0,0,0,0,1,0)


def finite(value):
    if type(value) not in (int,float): return False
    try: return math.isfinite(value)
    except OverflowError: return False


class UnitRegistry:
    def __init__(self,path='/contracts/units.v1.json'):
        data=json.loads(Path(path).read_text())
        if (data.get('schema')!='robot-units.v1'
                or data.get('bases')!=['length','mass','time','current','temperature','angle']):
            raise ExprError('RF4003','invalid unit contract')
        self._dimensions={}
        for name,vector in data['dimensions'].items():
            if len(vector)!=6 or any(type(power) is not int or abs(power)>8 for power in vector):
                raise ExprError('RF4003','invalid dimension vector')
            self._dimensions[name]=tuple(vector)
        self._units={}
        self._canonical={}
        for symbol,item in sorted(data['units'].items()):
            if (item['dimension'] not in self._dimensions or not finite(item['scale'])
                    or item['scale']<=0 or not finite(item.get('offset',0))):
                raise ExprError('RF4003','invalid unit definition')
            dimension=self._dimensions[item['dimension']]
            self._units[symbol]=(dimension,item['scale'],item.get('offset',0))
            if item['scale']==1 and item.get('offset',0)==0: self._canonical.setdefault(dimension,symbol)
        self.symbols=tuple(sorted((symbol for symbol in self._units if symbol!='1'),key=lambda value:(-len(value),value)))
        self.hash='sha256:'+hashlib.sha256(json.dumps(data,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()

    def info(self,symbol):
        try:return self._units[symbol or '1']
        except KeyError as error:raise ExprError('RF4003','unknown unit '+str(symbol)) from error

    def dimension(self,symbol):return self.info(symbol)[0]

    def to_base(self,value,symbol):
        if not finite(value):raise ExprError('RF4005','finite numeric unit value required')
        _,scale,offset=self.info(symbol)
        if scale==1 and offset==0:result=value
        else:
            # Unit definitions are decimal JSON constants. Normalize once at
            # high precision, then round to the target float; applying a signed
            # Celsius offset in binary first introduces avoidable cancellation.
            with localcontext() as context:
                context.prec=50
                result=float(Decimal(str(value))*Decimal(str(scale))+Decimal(str(offset)))
        if not finite(result):raise ExprError('RF4005','unit conversion overflow')
        return result

    def canonical(self,dimension):
        if dimension in self._canonical:return self._canonical[dimension]
        return '*'.join(name if power==1 else f'{name}^{power}'
            for name,power in zip(('m','kg','s','A','K','rad'),dimension) if power) or '1'

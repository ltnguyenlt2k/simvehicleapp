"""Explicit grammar, dimensions, safety boundaries; no eval as test oracle."""
import json
from pathlib import Path
import unittest
from jsonschema import Draft202012Validator

from expression import ExprError,UNKNOWN,compile_expression
from units import UnitRegistry


ARITHMETIC=[]
for a in range(1,5):
    for b in range(1,5):
        ARITHMETIC.extend([(f'{a} + {b}',a+b),(f'{a} - {b}',a-b),(f'{a} * {b}',a*b),(f'{a} / {b}',a/b)])
CONSTANTS=[('1 + 2 * 3',7),('(1 + 2) * 3',9),('10 - 3 - 2',5),('12 / 2 / 3',2),
    ('-2 * -3',6),('+.5',.5),('-.5',-.5),('1e2 + 2.5e-1',100.25),
    ('true and false',False),('true or false',True),('not true',False),
    ('not 1 < 2',False),('not false and true',True),('false or true and false',False),
    ('"MANUAL" == "MANUAL"',True),('"a" != "b"',True),
    ('100 cm == 1 m',True),('1000 ms == 1 s',True),('20 % == 0.2',True),
    ('1 m / 2 s',.5),('2 m/s * 3 s',6),('1 m/s² * 2 s',2),
    ('20 °C == 293.15 K',True),('20 °C > 0 K',True),('-20 °C == 253.15 K',True),
    ('-20 °C < 0 °C',True),
    ('abs(-3)',3),('abs(-2 m)',2),('min(3,1)',1),('min(3,2,1)',1),
    ('max(1,2,3)',3),('clamp(3,0,2)',2),('clamp(-1 m,0 m,2 m)',0),
    ('2147483647',2147483647),('9223372036854775807',9223372036854775807),
    ('-9223372036854775808',-9223372036854775808)]
for a,b in ((1,2),(2,1),(2,2)):
    CONSTANTS.extend([(f'{a} < {b}',a<b),(f'{a} <= {b}',a<=b),(f'{a} > {b}',a>b),
        (f'{a} >= {b}',a>=b),(f'{a} == {b}',a==b),(f'{a} != {b}',a!=b)])
INVALID=[('1 / 0','RF4005'),('1e309','RF4005'),('1e308 * 1e308','RF4005'),
    ('9223372036854775808','RF4005'),('9223372036854775807 + 1','RF4005'),
    ('true + 1','RF4002'),('1 and true','RF4002'),('not 1','RF4002'),
    ('"a" + "b"','RF4002'),('"a" < "b"','RF4002'),('true == 1','RF4002'),
    ('1 m + 1 s','RF4003'),('1 m == 1 s','RF4003'),('1 m/s < 2 rad/s','RF4003'),
    ('20 °C + 1 K','RF4003'),('2 K - 1 K','RF4003'),('abs(20 °C)','RF4003'),('-(20 °C)','RF4003'),
    ('1 kg','RF4003'),('1 unknown_unit','RF4003'),
    ('min(1,true)','RF4002'),('min()','RF4002'),('abs(1,2)','RF4002'),
    ('clamp(1,2,0)','RF4005'),('max(1,2,3,4)','RF4002'),
    ('missing + 1','RF4004'),('Robot.DoesNotExist','RF3002'),
    ('Robot.Safety.Arm','RF3003'),('Robot.Motion.Velocity','RF3003'),
    ('__import__("os")','RF4004'),('open("x")','RF4004'),('lambda x: x','RF4001'),
    ('[1,2]','RF4001'),('x[0]','RF4001'),('1 ** 2','RF4001'),('true && false','RF4001'),
    ('1; stop()','RF4001'),('1 +','RF4001'),('(1','RF4001'),('"unterminated','RF4001'),
    ('','RF4001'),('('*70+'1'+')'*70,'RF4001'),('+'.join(['1']*80),'RF4001'),
    ('+'.join(['1']*260),'RF4001'),
    ('1 '*2200,'RF4001')]


class ExpressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog=json.loads(Path('/contracts/fixtures/rss-go2-catalog.v1.json').read_text())
        schema=json.loads(Path('/contracts/rfir.v1.json').read_text())
        cls.ast_validator=Draft202012Validator({'$ref':'#/$defs/expr','$defs':schema['$defs']})
        cls.variables={'count':{'type':'int32','initial':0},'speed':{'type':'float64','unit':'m/s','initial':0},
                       'enabled':{'type':'bool','initial':False},'label':{'type':'string','initial':'x'}}

    def test_more_than_100_explicit_cases(self):
        self.assertGreaterEqual(len(ARITHMETIC)+len(CONSTANTS)+len(INVALID),100)

    def test_constants_precedence_units_and_closed_functions(self):
        for source,expected in ARITHMETIC+CONSTANTS:
            with self.subTest(source=source):
                expression=compile_expression(source,self.catalog,self.variables)
                self.ast_validator.validate(expression.ast)
                self.assertIsNot(expression.constant,UNKNOWN)
                if type(expected) is bool: self.assertIs(expression.constant,expected)
                elif type(expected) is int: self.assertEqual(expression.constant,expected)
                else: self.assertAlmostEqual(expression.constant,expected,places=10)

    def test_deliberate_type_unit_numeric_syntax_and_limit_errors(self):
        for source,code in INVALID:
            with self.subTest(source=source):
                with self.assertRaises(ExprError) as caught:
                    compile_expression(source,self.catalog,self.variables)
                self.assertEqual(caught.exception.code,code,source)

    def test_signal_variable_ast_retains_type_dimension_and_dependency_without_folding(self):
        expression=compile_expression('Robot.Pose.Position.X + 20 cm',self.catalog,self.variables)
        self.assertIs(expression.constant,UNKNOWN)
        self.assertEqual(expression.dimension,(1,0,0,0,0,0))
        self.assertEqual(expression.ast['unit'],'m')
        self.assertEqual(expression.paths,('Robot.Pose.Position.X',))
        self.assertEqual(compile_expression('speed * 2 s',self.catalog,self.variables).dimension,(1,0,0,0,0,0))
        self.assertEqual(compile_expression('Robot.Safety.Mode == "MANUAL"',self.catalog,self.variables).kind,'bool')
        self.assertEqual(compile_expression('count + 1',self.catalog,self.variables).kind,'int32')

    def test_unit_conversion_is_shared_wire_data_not_shared_runtime_code(self):
        units=UnitRegistry()
        self.assertAlmostEqual(units.to_base(20,'%'),.2)
        self.assertAlmostEqual(units.to_base(100,'cm'),1.)
        self.assertAlmostEqual(units.to_base(1000,'ms'),1.)
        self.assertAlmostEqual(units.to_base(20,'°C'),293.15)
        self.assertEqual(units.dimension('m/s'),(1,0,-1,0,0,0))
        self.assertNotEqual(units.dimension('m/s'),units.dimension('rad/s'))
        for value in (True,float('nan'),float('inf')):
            with self.subTest(value=value),self.assertRaises(ExprError): units.to_base(value,'m')

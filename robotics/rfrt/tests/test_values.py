import json
from pathlib import Path
import unittest

from rfrt.values import Values,UNKNOWN,EvaluationError,Unavailable,checked


def literal(value,kind='float64'):return {'kind':'literal','type':kind,'value':value}
def binary(op,left,right,kind='float64'):return {'kind':'binary','operator':op,'left':left,'right':right,'type':kind}


class ValuesTests(unittest.TestCase):
    def setUp(self):
        catalog=json.loads(Path('/contracts/fixtures/rss-go2-catalog.v1.json').read_text())
        self.vars={'charge':{'type':'float64','unit':'%','initial':50},'count':{'type':'int32','initial':0},
            'enabled':{'type':'bool','initial':False},'temp':{'type':'float64','unit':'°C','initial':-20}}
        self.values=Values(catalog,self.vars,json.loads(Path('/contracts/units.v1.json').read_text()))

    def test_118_compiler_ast_wire_cases_against_explicit_expected_values(self):
        cases=json.loads((Path(__file__).parent/'fixtures/expressions.json').read_text())
        self.assertEqual(len(cases),118)
        for case in cases:
            with self.subTest(source=case['source']):
                actual=self.values.evaluate(case['ast'],{})
                self.assertEqual(actual,case['expected'])
                if type(case['expected']) is bool:self.assertIs(actual,case['expected'])

    def test_signal_units_and_variable_round_trip_use_declared_storage_units(self):
        signal={'kind':'signal','path':'Robot.PowerSystem.Battery.StateOfCharge','type':'float64','unit':'1'}
        self.assertEqual(self.values.evaluate(signal,{signal['path']:20}),.2)
        self.values.assign('charge',.2);self.assertEqual(self.values.variables['charge'],20.)
        self.assertEqual(self.values.evaluate({'kind':'var','name':'charge','type':'float64','unit':'1'},{}),.2)
        self.assertEqual(self.values.evaluate({'kind':'var','name':'temp','type':'float64','unit':'K'},{}),253.15)
        self.values.assign('temp',253.15);self.assertEqual(self.values.variables['temp'],-20.)

    def test_missing_signal_and_condition_never_become_zero_or_false(self):
        signal={'kind':'signal','path':'Robot.Safety.IsArmed','type':'bool'}
        self.assertIs(self.values.evaluate(signal,{}),UNKNOWN)
        with self.assertRaises(Unavailable):self.values.condition(signal,{})
        with self.assertRaises(Unavailable):bool(UNKNOWN)
        with self.assertRaises(Unavailable):self.values.assign('enabled',UNKNOWN)
        self.assertIs(self.values.variables['enabled'],False)

    def test_three_valued_short_circuit_does_not_evaluate_unneeded_unsafe_operand(self):
        absent={'kind':'signal','path':'Robot.Safety.IsArmed','type':'bool'}
        error=binary('/',literal(1),literal(0))
        for op,value in (('and',False),('or',True)):
            self.assertIs(self.values.evaluate(binary(op,literal(value,'bool'),error,'bool'),{}),value)
            self.assertIs(self.values.evaluate(binary(op,absent,literal(value,'bool'),'bool'),{}),value)
        self.assertIs(self.values.evaluate(binary('and',absent,literal(True,'bool'),'bool'),{}),UNKNOWN)
        self.assertIs(self.values.evaluate(binary('or',absent,literal(False,'bool'),'bool'),{}),UNKNOWN)

    def test_runtime_division_overflow_and_inverted_dynamic_clamp_fail(self):
        cases=[binary('/',literal(1),literal(0)),binary('*',literal(1e308),literal(1e308)),
            binary('+',literal(2**31-1,'int32'),literal(1,'int32'),'int32'),
            {'kind':'unary','operator':'-','operand':literal(-2**63,'int64'),'type':'int64'},
            {'kind':'call','name':'clamp','args':[literal(1),literal(2),literal(0)],'type':'float64'},
            {'kind':'call','name':'__import__','args':[],'type':'string'}]
        for node in cases:
            with self.subTest(node=node),self.assertRaises(EvaluationError):self.values.evaluate(node,{})

    def test_wrong_type_nonfinite_enum_and_narrowing_are_rejected(self):
        for value,spec in [(True,{'type':'int32'}),(1,{'type':'bool'}),('wrong',{'type':'enum','values':['SIM']}),
                           (float('nan'),{'type':'float64'}),(float('inf'),{'type':'float64'}),
                           (2**64,{'type':'int64'}),(1e40,{'type':'float32'}),(1.5,{'type':'int32'})]:
            with self.subTest(value=value),self.assertRaises(EvaluationError):checked(value,spec)
        for value in (1.5,True,2**31):
            with self.subTest(value=value),self.assertRaises(EvaluationError):self.values.assign('count',value)
        self.assertEqual(self.values.variables['count'],0)

    def test_dynamic_expression_and_assignment_use_one_explicit_snapshot(self):
        signal={'kind':'signal','path':'Robot.Pose.Position.X','type':'float64','unit':'m'}
        node=binary('+',signal,literal(.2))
        self.assertEqual(self.values.evaluate(node,{'Robot.Pose.Position.X':.3}),.5)
        self.assertIs(self.values.evaluate(node,{}),UNKNOWN)
        self.values.assign('count',5)
        self.assertEqual(self.values.evaluate(binary('*',{'kind':'var','name':'count','type':'int32'},literal(2,'int32'),'int32'),{}),10)

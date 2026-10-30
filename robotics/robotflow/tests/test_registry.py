import json
from pathlib import Path
import tempfile
import unittest

from registry import RegistryError,load_registry,normalize_properties


class RegistryTests(unittest.TestCase):
    def test_registry_is_complete_localized_and_canonical(self):
        first=load_registry(); second=load_registry()
        self.assertEqual(first.hash,second.hash)
        self.assertEqual(len(first.records),24)
        self.assertEqual([item['id'] for item in first.records],sorted(item['id'] for item in first.records))
        for block in first.records:
            self.assertTrue(block['title']['vi']); self.assertTrue(block['semantics']['en'])
            self.assertIsInstance(normalize_properties(block,{}),dict)
        changed=first.records
        changed[0]['title']['en']='mutated'
        self.assertNotEqual(first.records[0]['title']['en'],'mutated')
        self.assertEqual(first.public()['registryHash'],first.hash)
        self.assertEqual(first.public()['blocks'],first.records)
        with self.assertRaises(RegistryError): first.get('rf.unknown')

    def test_robot_blocks_require_timeout_and_all_five_results(self):
        for block in load_registry().records:
            if block['category']!='robot': continue
            with self.subTest(block=block['id']):
                self.assertIn('timeoutMs',block['props'])
                self.assertEqual(set(block['ports']['outputs']),{'succeeded','failed','rejected','cancelled','timed_out'})
                self.assertTrue(all(port['required'] for port in block['ports']['outputs'].values()))
        stop=load_registry().get('rf.stop')
        self.assertEqual(stop['lowering'],'stop')
        self.assertIn('priority',stop['semantics']['en'].lower())

    def test_closed_props_reject_bool_numbers_nonfinite_unknown_enum_and_waypoints(self):
        registry=load_registry()
        for block,changes in [('rf.move',{'durationMs':True}),('rf.move',{'timeoutMs':float('inf')}),
            ('rf.perform',{'name':'UNKNOWN'}),('rf.log',{'shell':'code'}),
            ('rf.patrol',{'waypoints':[[0,float('nan')]]}),('rf.patrol',{'waypoints':[]}),
            ('rf.patrol',{'waypoints':[[2**2000,0]]}),
            ('rf.loop',{'count':0})]:
            with self.subTest(block=block,changes=changes),self.assertRaises(RegistryError):
                normalize_properties(registry.get(block),changes)

    def test_file_boundary_rejects_duplicate_keys_aliases_unknown_lowering_and_identity(self):
        valid=load_registry().get('rf.log')
        fixtures=[('rf.log.block.yaml','id: rf.log\nid: rf.log\n'),
            ('rf.log.block.yaml','a: &a [1]\nb: *a\n'),
            ('rf.log.block.yaml',json.dumps(dict(valid,lowering='shell'))),
            ('rf.log.block.yaml',json.dumps(dict(valid,lowering='arm'))),
            ('rf.log.block.yaml',json.dumps(dict(valid,category='robot'))),
            ('rf.other.block.yaml',json.dumps(valid))]
        for name,text in fixtures:
            with self.subTest(name=name,text=text),tempfile.TemporaryDirectory() as directory:
                (Path(directory)/name).write_text(text)
                with self.assertRaises(RegistryError): load_registry(directory)

    def test_duplicate_enum_and_inverted_numeric_bounds_are_not_valid_registry(self):
        valid=load_registry().get('rf.perform')
        for descriptor in ({'type':'enum','required':True,'values':['BOW','BOW'],'default':'BOW'},
                           {'type':'number','required':True,'minimum':2,'maximum':1,'default':1}):
            with tempfile.TemporaryDirectory() as directory:
                block=json.loads(json.dumps(valid)); block['props']['name']=descriptor
                (Path(directory)/'rf.perform.block.yaml').write_text(json.dumps(block))
                with self.assertRaises(RegistryError): load_registry(directory)

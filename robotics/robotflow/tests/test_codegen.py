import ast
import copy
import hashlib
import json
from pathlib import Path
import runpy
import tempfile
import time
import unittest

from jsonschema import Draft202012Validator
from codegen import build_application
from templates import templates

ROOT=Path(__file__).resolve().parents[1]
CATALOG=json.loads(Path('/contracts/fixtures/rss-go2-catalog.v1.json').read_text())
PROFILE=json.loads((ROOT/'profiles/dog-go2-sim.json').read_text())
PROFILE['allowRemoteArm']=True  # Explicit unit-fixture SIM authorization; no app is started.


def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
def digest(value):return 'sha256:'+hashlib.sha256(value).hexdigest()


class CodegenTests(unittest.TestCase):
    def test_complex_templates_finish_without_recursive_schema_explosion(self):
        started=time.monotonic()
        for name,source in templates().items():
            result=build_application(source,CATALOG,PROFILE)
            self.assertTrue(result['ok'],(name,result['diagnostics']))
        self.assertLess(time.monotonic()-started,10,
            'opcode validation must traverse only the matching recursive statement schema')

    def test_rw_a_to_d_golden_twice_byte_identical(self):
        for name,source in templates().items():
            with self.subTest(name=name):
                first=build_application(source,CATALOG,PROFILE)
                self.assertTrue(first['ok'],first['diagnostics'])
                second=build_application(source,CATALOG,PROFILE)
                self.assertEqual(first['files'],second['files'])
                expected=json.loads((ROOT/'goldens'/(name+'.json')).read_text())
                self.assertEqual({'ir':first['ir'],'files':first['files']},expected)

    def test_all_file_hashes_lock_source_and_artifact_hashes_are_exact(self):
        for name,source in templates().items():
            with self.subTest(name=name):
                result=build_application(source,CATALOG,PROFILE)
                self.assertTrue(result['ok'],result['diagnostics'])
                files=result['files'];lock=json.loads(files['rflow.lock.json'])
                Draft202012Validator(json.loads(Path('/contracts/rflow-lock.v1.json').read_text())).validate(lock)
                self.assertNotIn('runtimePackageHash',lock,'unavailable wheel hash must not be fabricated')
                self.assertEqual(set(lock['files']),set(files)-{'rflow.lock.json'})
                for path,expected in lock['files'].items():self.assertEqual(expected,digest(files[path].encode()))
                source_files={path:lock['files'][path] for path in lock['files'] if path.startswith('app/')}
                self.assertEqual(lock['sourceHash'],digest(canonical(source_files)))
                artifact=lock.pop('artifactHash');self.assertEqual(artifact,digest(canonical(lock)))

    def test_ui_layout_and_input_order_change_no_emitted_byte(self):
        source=templates()['RW-B'];first=build_application(source,CATALOG,PROFILE)
        modified=copy.deepcopy(source);modified['nodes'].reverse();modified['edges'].reverse()
        for node in modified['nodes']:node['ui']={'x':9999,'y':-7777}
        second=build_application(modified,CATALOG,PROFILE)
        self.assertEqual(first['files'],second['files'])
        self.assertNotIn('ui',json.loads(second['files']['workflow.json'])['nodes'][0])

    def test_generated_python_is_native_control_flow_and_import_has_no_run(self):
        shapes=set()
        for name,source in templates().items():
            result=build_application(source,CATALOG,PROFILE);self.assertTrue(result['ok'],result['diagnostics'])
            for path,content in result['files'].items():
                if path.endswith('.py'):
                    tree=ast.parse(content,filename=path);shapes.update(type(node).__name__ for node in ast.walk(tree))
                    self.assertNotIn('interpret_ir',content)
            with tempfile.TemporaryDirectory() as directory:
                path=Path(directory)/'flow.py';path.write_text(result['files']['app/flow.py'])
                module=runpy.run_path(str(path))
                self.assertTrue(module['BEHAVIORS'])
                self.assertEqual(module['FLOW_META']['irHash'],result['ir']['irHash'])
        self.assertTrue({'AsyncFunctionDef','If','For','While','AsyncWith'}<=shapes)

    def test_hostile_log_text_is_data_not_executed_at_module_import(self):
        from test_compiler import graph
        with tempfile.TemporaryDirectory() as directory:
            marker=Path(directory)/'executed'
            source=graph();source['nodes'][1]['props']['message']=f"__import__('pathlib').Path({str(marker)!r}).write_text('bad')"
            result=build_application(source,CATALOG,PROFILE);self.assertTrue(result['ok'],result['diagnostics'])
            path=Path(directory)/'flow.py';path.write_text(result['files']['app/flow.py']);runpy.run_path(str(path))
            self.assertFalse(marker.exists())

    def test_malformed_runtime_digest_is_rejected(self):
        source=templates()['RW-C']
        result=build_application(source,CATALOG,PROFILE,runtime_package_hash='not-a-sha256')
        self.assertFalse(result['ok']);self.assertIsNone(result['files'])

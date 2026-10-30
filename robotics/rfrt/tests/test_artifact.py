import copy
import json
from pathlib import Path
import tempfile
import unittest

from rfrt.artifact import ArtifactError,canonical,decode,digest,verify_application

# Deliberate unit-test identity, not a built wheel or live deployment proof.
UNIT_RUNTIME='sha256:'+'1'*64


def fixture(name='RW-B'):
    return json.loads((Path('/fixtures')/(name+'.json')).read_text())['files']


def resign(files):
    lock=json.loads(files['rflow.lock.json'])
    lock['runtimePackageHash']=UNIT_RUNTIME
    lock['files']={path:digest(content.encode()) for path,content in files.items() if path!='rflow.lock.json'}
    lock['sourceHash']=digest(canonical({path:value for path,value in sorted(lock['files'].items()) if path.startswith('app/')}))
    lock['artifactHash']=digest(canonical({key:value for key,value in lock.items() if key!='artifactHash'}))
    files['rflow.lock.json']=canonical(lock).decode()+'\n'
    return files


def write(root,files):
    for path,content in files.items():
        target=root/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(content)


class ArtifactTests(unittest.TestCase):
    def test_all_codegen_fixtures_verify_and_return_immutable_checked_bytes(self):
        for name in ('RW-A','RW-B','RW-C','RW-D'):
            with self.subTest(name=name),tempfile.TemporaryDirectory() as folder:
                root=Path(folder);files=resign(fixture(name));write(root,files)
                app=verify_application(root,UNIT_RUNTIME)
                self.assertEqual(app.json('rfir.json')['schema'],'rfir.v1')
                with self.assertRaises(TypeError):app.files['app/flow.py']=b'bad'
                (root/'app/flow.py').write_text('bad')
                self.assertEqual(app.files['app/flow.py'],files['app/flow.py'].encode())

    def test_unpinned_codegen_and_wrong_installed_runtime_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);write(root,fixture())
            with self.assertRaisesRegex(ArtifactError,'runtime package pin'):verify_application(root,UNIT_RUNTIME)
            write(root,resign(fixture()))
            with self.assertRaises(ArtifactError):verify_application(root,'sha256:'+'2'*64)

    def test_every_file_tamper_and_missing_file_is_rejected_before_import(self):
        for name in fixture():
            with self.subTest(name=name),tempfile.TemporaryDirectory() as folder:
                root=Path(folder);write(root,resign(fixture()))
                (root/name).write_text('tampered')
                with self.assertRaises(ArtifactError):verify_application(root,UNIT_RUNTIME)
                (root/name).unlink()
                with self.assertRaises(ArtifactError):verify_application(root,UNIT_RUNTIME)

    def test_resigned_manifest_cannot_hide_inconsistent_semantic_hashes(self):
        for path in ('rfir.json','profile.json','units.v1.json','registry.json','workflow.json','rss-catalog.json'):
            with self.subTest(path=path),tempfile.TemporaryDirectory() as folder:
                files=fixture();value=json.loads(files[path])
                if path=='rfir.json':value['irHash']='sha256:'+'b'*64
                elif path=='profile.json':value['maxNodes']=999
                elif path=='units.v1.json':value['units']['m']['scale']=2
                elif path=='registry.json':value['blocks'][0]['title']['en']='Changed'
                elif path=='workflow.json':value['nodes'][0]['props']['x']='Changed'
                else:value['nodes']['Robot.Identity.Id']['type']='bool'
                files[path]=canonical(value).decode();root=Path(folder);write(root,resign(files))
                with self.assertRaises(ArtifactError):verify_application(root,UNIT_RUNTIME)

    def test_symlink_file_directory_and_root_are_rejected(self):
        for target in ('app/flow.py','app',''):
            with self.subTest(target=target),tempfile.TemporaryDirectory() as folder:
                root=Path(folder)/'root';root.mkdir();write(root,resign(fixture()))
                path=root/target if target else root
                moved=Path(folder)/'moved';path.rename(moved);path.symlink_to(moved,target_is_directory=moved.is_dir())
                with self.assertRaises(ArtifactError):verify_application(root,UNIT_RUNTIME)

    def test_strict_json_rejects_duplicates_nonfinite_and_invalid_utf8(self):
        for raw in (b'{"a":1,"a":2}',b'{"a":NaN}',b'{"a":1e309}',b'\xff',b'['*1000):
            with self.subTest(raw=raw[:40]),self.assertRaises(ArtifactError):decode(raw)

    def test_unlisted_python_and_shadow_runtime_directories_are_rejected(self):
        for path in ('app/unlisted.py','rfrt/__init__.py','sitecustomize.py'):
            with self.subTest(path=path),tempfile.TemporaryDirectory() as folder:
                root=Path(folder);write(root,resign(fixture()))
                target=root/path;target.parent.mkdir(exist_ok=True);target.write_text('raise RuntimeError("bad")')
                with self.assertRaisesRegex(ArtifactError,'unexpected application'):verify_application(root,UNIT_RUNTIME)

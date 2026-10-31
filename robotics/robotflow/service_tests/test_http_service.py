"""Actual ASGI HTTP and pure compiler output checks, no SDK/ROS imports."""
import asyncio,copy,json,unittest
import httpx
from http_service import api,MAX_BODY
from templates import templates

class CompilerHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=api),base_url='http://compiler')
    async def asyncTearDown(self):await self.client.aclose()
    async def test_public_blocks_catalog_and_templates_match_owned_sources(self):
        blocks=(await self.client.get('/blocks')).json()
        self.assertEqual(len(blocks['blocks']),24)
        catalog=(await self.client.get('/rss/catalog')).json()
        self.assertEqual(len(catalog['nodes']),113)
        self.assertEqual((await self.client.get('/templates')).json()['templates'],templates())
        self.assertTrue((await self.client.get('/health')).json()['ready'])
    async def test_native_build_is_exact_and_deterministic_and_requires_explicit_policy(self):
        for name,workflow in templates().items():
            with self.subTest(template=name):
                body={'workflow':workflow,'runtimePackageHash':'sha256:'+'a'*64,'authorizeSimArm':True}
                one=await self.client.post('/build',json=body);two=await self.client.post('/build',json=body)
                self.assertEqual(one.status_code,200);self.assertEqual(one.json(),two.json())
                result=one.json();self.assertTrue(result['ok'],result['diagnostics'])
                self.assertEqual(len(result['files']),10)
                lock=json.loads(result['files']['rflow.lock.json'])
                self.assertEqual(lock['runtimePackageHash'],body['runtimePackageHash'])
                self.assertTrue((await self.client.post('/lint',json={'workflow':workflow,'authorizeSimArm':True})).json()['ok'])
                denied=await self.client.post('/build',json={**body,'authorizeSimArm':False})
                self.assertFalse(denied.json()['ok']);self.assertIsNone(denied.json()['files'])
    async def test_missing_result_branch_is_diagnostic_and_build_never_returns_partial_files(self):
        value=copy.deepcopy(templates()['RW-C'])
        value['edges']=[edge for edge in value['edges'] if edge['from']!=['jump','failed']]
        response=await self.client.post('/build',json={'workflow':value,'authorizeSimArm':True,'runtimePackageHash':'sha256:'+'a'*64})
        result=response.json();self.assertFalse(result['ok']);self.assertTrue(result['diagnostics']);self.assertIsNone(result['files'])
    async def test_closed_request_boolean_and_runtime_pin_reject_before_compile(self):
        workflow=templates()['RW-C']
        for body in ({'workflow':workflow,'authorizeSimArm':'true'},
                     {'workflow':workflow,'bus':'arbitrary'},
                     {'workflow':workflow,'runtimePackageHash':'latest'}):
            response=await self.client.post('/build',json=body)
            self.assertEqual(response.status_code,422)
            self.assertNotIn('input',response.text)
    async def test_oversized_body_with_or_without_content_length_is_bounded(self):
        payload=b'x'*(MAX_BODY+1)
        response=await self.client.post('/lint',content=payload)
        self.assertEqual(response.status_code,413)
        async def stream():
            yield b'x'*MAX_BODY
            yield b'x'
        response=await self.client.post('/lint',content=stream())
        self.assertEqual(response.status_code,413)

    async def test_duplicate_and_nonfinite_json_is_rejected_before_semantic_compile(self):
        for raw in (b'{"workflow":{},"authorizeSimArm":false,"authorizeSimArm":true}',
                    b'{"workflow":{"x":NaN}}',b'{"workflow":{"x":1e999}}'):
            response=await self.client.post('/lint',content=raw,headers={'Content-Type':'application/json'})
            self.assertEqual(response.status_code,422)
            self.assertEqual(response.json()['error'],'strict JSON object required')

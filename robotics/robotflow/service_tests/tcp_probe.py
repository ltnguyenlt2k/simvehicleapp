"""Actual HTTP compiler to installed artifact verifier; generated code never executed."""
import json,tempfile
from pathlib import Path
import httpx
from rfrt.launch import runtime_info
from rfrt.artifact import verify_application

info=runtime_info();results=[]
with httpx.Client(base_url='http://compiler:8012',timeout=10) as client:
    assert client.get('/health').json()['ready']
    templates=client.get('/templates').json()['templates']
    for name,workflow in templates.items():
        reply=client.post('/build',json={'workflow':workflow,'authorizeSimArm':True,
                                       'runtimePackageHash':info['packageHash']})
        reply.raise_for_status();result=reply.json();assert result['ok'],result['diagnostics']
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for relative,content in result['files'].items():
                target=root/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(content)
            checked=verify_application(root,info['packageHash'])
            results.append({'template':name,'artifactHash':checked.artifact_hash,'files':len(checked.files)})
    response=client.post('/build',json={'workflow':templates['RW-C'],'runtimePackageHash':info['packageHash'],'bus':'injected'})
    assert response.status_code==422
print(json.dumps({'passed':True,'scope':'actual compiler HTTP / installed SDK integrity check only; no native code execution',
                  'runtimePackageHash':info['packageHash'],'templates':results}),flush=True)

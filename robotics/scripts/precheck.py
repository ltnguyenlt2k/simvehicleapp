from pathlib import Path
import hashlib
import json
import re
root = Path(__file__).resolve().parents[1]
errors=[]
for p in root.rglob("*"):
    if p.resolve() == Path(__file__).resolve():
        continue
    if not p.is_file() or any(x in p.parts for x in ("runtime","__pycache__","node_modules")):
        continue
    if p.suffix in (".py",".ts",".tsx",".sh") or p.name=="Dockerfile":
        if re.search(r"(?:from|import|COPY|FROM|source).*?(?:modules/|scripts/sv|kuksa|velocitas|vss-tools)",p.read_text(),re.I):
            errors.append(str(p.relative_to(root)))
if errors: raise SystemExit("cross-stack imports: "+", ".join(errors))
source = root / 'protobus/interface-source'
manifest = json.loads((source / 'manifest.json').read_text())
for name, expected in manifest['files'].items():
    target = (source / name).resolve()
    if not target.is_relative_to(source.resolve()):
        raise SystemExit('Interface manifest path traversal')
    if hashlib.sha256(target.read_bytes()).hexdigest() != expected:
        raise SystemExit('Pinned interface checksum mismatch: ' + name)
print("Independent executable dependency guard PASS")
wire = root / 'contracts/dog-control-authority.v1.json'
provenance = json.loads((root / 'contracts/dog-control-authority.provenance.json').read_text())
if hashlib.sha256(wire.read_bytes()).hexdigest() != provenance['sha256']:
    raise SystemExit('Pinned dog authority wire schema checksum mismatch')
if not re.fullmatch(r'[a-f0-9]{40}', provenance['commit']):
    raise SystemExit('Dog authority wire schema must pin an exact source commit')
license_file = root / 'contracts/licenses/dog-ros2-simulation-LICENSE'
if hashlib.sha256(license_file.read_bytes()).hexdigest() != provenance['licenseSha256']:
    raise SystemExit('Pinned dog authority license checksum mismatch')
print('Pinned dog authority wire contract PASS')
unit_contract=json.loads((root/'contracts/units.v1.json').read_text())
if (unit_contract.get('schema')!='robot-units.v1'
        or unit_contract['units']!=json.loads((root/'rss/units.yaml').read_text())):
    raise SystemExit('RSS unit compatibility snapshot differs from canonical contract')
print('Canonical robotics unit data/snapshot PASS')

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

#!/usr/bin/env bash
# Verifies simvehicleapp.lock.yaml against the repository (ADR-0002 §3, M11-T10): every module's pinned SHA
# (dev phase: git tree of modules/<m>; release phase: submodule commit) must equal what <rev> contains.
#   scripts/lock-verify.sh [lock-file] [rev]      (defaults: simvehicleapp.lock.yaml, HEAD)
set -euo pipefail
cd "$(dirname "$0")/.."
lock="${1:-simvehicleapp.lock.yaml}"
rev="${2:-HEAD}"
python3 - "$lock" "$rev" <<'PY'
import sys
sys.path.insert(0, "scripts")
from modules import parse_lock, pin, MODULES
lock, rev = sys.argv[1], sys.argv[2]
try:
    mods = parse_lock(open(lock).read())
except OSError as e:
    sys.exit(f"lock-verify: {e}")
errors = []
for m in MODULES:
    kind, sha = pin(m, rev)
    if kind == "missing":
        continue
    entry = mods.get(m)
    if entry is None:
        errors.append(f"{m}: not in the lock")
    elif entry.get(kind) != sha:
        errors.append(f"{m}: lock {kind} {entry.get(kind, '—')[:12]} ≠ {rev} {sha[:12]}")
for m in mods:
    if m not in MODULES:
        errors.append(f"{m}: in the lock but not a module")
if errors:
    print("lock-verify: FAIL\n  " + "\n  ".join(errors), file=sys.stderr)
    sys.exit(1)
print(f"lock-verify: PASS ({len(mods)} modules at {rev})")
PY

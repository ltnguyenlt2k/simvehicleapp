#!/usr/bin/env python3
"""diagnostics-guard (ADR-0016 §2: diagnostic codes are public API).

Compares schemas/diagnostics-catalog.v1.json with its version at a base revision and fails when a code
was removed or renamed, or when a code changed severity/stage (callers branch on both). Adding codes and
flagging one `deprecated` are allowed.

  python3 scripts/ci/diagnostics_guard.py [--base REV]   # default base: HEAD~1
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = "modules/simvehicleapp-contracts/schemas/diagnostics-catalog.v1.json"


def load_at(root: Path, rev: str) -> dict | None:
    r = subprocess.run(["git", "show", f"{rev}:{CATALOG}"], cwd=root, capture_output=True, text=True)
    if r.returncode != 0:
        return None
    return json.loads(r.stdout)


def compare(base: dict, current: dict) -> list[str]:
    before = {c["code"]: c for c in base.get("codes", [])}
    now = {c["code"]: c for c in current.get("codes", [])}
    errors = []
    for code, old in sorted(before.items()):
        new = now.get(code)
        if new is None:
            errors.append(f"{code} was removed or renamed — codes are public API; flag it `deprecated` instead")
            continue
        for field in ("severity", "stage"):
            if new.get(field) != old.get(field):
                errors.append(f"{code}: {field} changed {old.get(field)!r} → {new.get(field)!r}")
    return errors


def run(root: Path, base_rev: str) -> list[str]:
    current = json.loads((root / CATALOG).read_text())
    base = load_at(root, base_rev)
    if base is None:
        print(f"diagnostics-guard: no catalog at {base_rev} (new file or shallow history) — nothing to compare")
        return []
    return compare(base, current)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=ROOT)
    ap.add_argument("--base", default="HEAD~1")
    args = ap.parse_args()
    errors = run(args.root.resolve(), args.base)
    for e in errors:
        print(f"diagnostics-guard: {e}")
    print(f"diagnostics-guard: {'FAIL' if errors else 'PASS'} (base {args.base})")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

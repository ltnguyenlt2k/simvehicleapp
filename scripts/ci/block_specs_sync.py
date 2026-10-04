#!/usr/bin/env python3
"""block-specs-sync (M02-T09, ADR-0011 §4 + Notes).

The studio may not import core code (AGENTS §2.2), so it keeps a snapshot of the compiler's
`GET /blocks` body in `modules/simvehicleapp-studio/apps/sim/blocks/vehicle/block-specs.json`;
`block-parity.test.ts` checks every `sv_*` BlockConfig against that snapshot. This meta-level check
keeps the snapshot equal to core's `packages/blocks/<type>/spec.json` files (sorted by `type`, same
order as `BLOCK_SPECS`).

  python3 scripts/ci/block_specs_sync.py           # check (exit 1 on drift)
  python3 scripts/ci/block_specs_sync.py --write   # regenerate the snapshot from core
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CORE_BLOCKS = Path("modules/simvehicleapp-core/packages/blocks")
SNAPSHOT = Path("modules/simvehicleapp-studio/apps/sim/blocks/vehicle/block-specs.json")


def core_specs(root: Path) -> dict:
    specs = [json.loads(p.read_text()) for p in sorted((root / CORE_BLOCKS).glob("sv_*/spec.json"))]
    return {"blocks": sorted(specs, key=lambda s: s["type"])}


def render(doc: dict) -> str:
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def run(root: Path, write: bool = False) -> list[str]:
    expected = core_specs(root)
    if not expected["blocks"]:
        return [f"no BlockSpec found under {CORE_BLOCKS}"]
    path = root / SNAPSHOT
    if write:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render(expected))
        return []
    if not path.is_file():
        return [f"{SNAPSHOT} is missing — run scripts/ci/block_specs_sync.py --write"]
    try:
        actual = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        return [f"{SNAPSHOT}: invalid JSON ({e})"]
    if actual != expected:
        want = [s["type"] for s in expected["blocks"]]
        got = [s.get("type") for s in actual.get("blocks", [])]
        detail = f"types {got} vs core {want}" if got != want else "spec content differs"
        return [f"{SNAPSHOT} is out of date with {CORE_BLOCKS} ({detail}) — run scripts/ci/block_specs_sync.py --write"]
    return []


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=ROOT)
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    errors = run(args.root.resolve(), args.write)
    for e in errors:
        print(f"block-specs-sync: {e}")
    print(f"block-specs-sync: {'FAIL' if errors else ('WROTE' if args.write else 'PASS')}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

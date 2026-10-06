#!/usr/bin/env python3
"""golden-sync (M04-T01, AGENTS §2.2).

The studio may not read files of another module, so it keeps a copy of each golden workflow's
`sim-state.json` (studio export of the workflow built through the UI) and `graph.json` in
`modules/simvehicleapp-studio/apps/sim/lib/sv/__golden__/<GW-X>/`; `graph-adapter.golden.test.ts`
adapts every `sim-state.json` and compares it with `graph.json`. This meta-level check keeps the
copy byte-identical to `modules/simvehicleapp-contracts/fixtures/golden/`.

  python3 scripts/ci/golden_sync.py           # check (exit 1 on drift)
  python3 scripts/ci/golden_sync.py --write   # refresh the studio copy from contracts
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path("modules/simvehicleapp-contracts/fixtures/golden")
COPY = Path("modules/simvehicleapp-studio/apps/sim/lib/sv/__golden__")
FILES = ("graph.json", "sim-state.json")


def expected(root: Path) -> dict[str, bytes]:
    """Relative path in the copy → content, for every golden that has a sim-state.json."""
    out: dict[str, bytes] = {}
    for gw in sorted(p for p in (root / SOURCE).glob("GW-*") if p.is_dir()):
        if not (gw / "sim-state.json").is_file():
            continue
        for name in FILES:
            out[f"{gw.name}/{name}"] = (gw / name).read_bytes()
    return out


def actual(root: Path) -> dict[str, bytes]:
    base = root / COPY
    if not base.is_dir():
        return {}
    return {str(p.relative_to(base)): p.read_bytes() for p in sorted(base.rglob("*.json"))}


def run(root: Path, write: bool = False) -> list[str]:
    want = expected(root)
    if not want:
        return [f"no golden with sim-state.json under {SOURCE}"]
    if write:
        shutil.rmtree(root / COPY, ignore_errors=True)
        for rel, data in want.items():
            path = root / COPY / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        return []
    have = actual(root)
    errors = []
    for rel in sorted(want.keys() - have.keys()):
        errors.append(f"{COPY}/{rel} is missing")
    for rel in sorted(have.keys() - want.keys()):
        errors.append(f"{COPY}/{rel} has no source in {SOURCE}")
    for rel in sorted(want.keys() & have.keys()):
        if want[rel] != have[rel]:
            errors.append(f"{COPY}/{rel} differs from {SOURCE}/{rel}")
    if errors:
        errors.append("run scripts/ci/golden_sync.py --write")
    return errors


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=ROOT)
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    errors = run(args.root.resolve(), args.write)
    for e in errors:
        print(f"golden-sync: {e}")
    print(f"golden-sync: {'FAIL' if errors else ('WROTE' if args.write else 'PASS')}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

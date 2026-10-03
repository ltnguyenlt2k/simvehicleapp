#!/usr/bin/env python3
"""Studio license guards (M01-T02c; extended in M01-T11, ADR-0004).

Fails when the Sim Enterprise code comes back:
  - the path modules/simvehicleapp-studio/apps/sim/ee exists, or
  - any source file of the studio imports `@/ee/` (static or dynamic import, vi.mock path);
and when the proprietary Sim copilot service comes back (M01-T03): `copilot.sim.ai`, `SIM_AGENT_API_URL`
or `COPILOT_API_KEY` in studio source code.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STUDIO = Path("modules/simvehicleapp-studio")
SKIP_DIRS = {"node_modules", ".next", ".turbo", ".git", "dist", "build"}
SOURCE_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"}
EE_IMPORT = re.compile(r"""['"`]@/ee/""")
COPILOT_SERVICE = re.compile(r"copilot\.sim\.ai|\bSIM_AGENT_API_URL\b|\bCOPILOT_API_KEY\b")


def run(root: Path) -> list[str]:
    studio = root / STUDIO
    errors: list[str] = []
    ee_dir = studio / "apps" / "sim" / "ee"
    if ee_dir.exists():
        errors.append(f"{ee_dir.relative_to(root)} exists — Sim Enterprise code must not be shipped (ADR-0004)")
    for dirpath, dirnames, filenames in os.walk(studio):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            path = Path(dirpath) / name
            if path.suffix not in SOURCE_EXT:
                continue
            try:
                text = path.read_text()
            except (UnicodeDecodeError, OSError):
                continue
            for m in EE_IMPORT.finditer(text):
                line = text.count("\n", 0, m.start()) + 1
                errors.append(f"{path.relative_to(root)}:{line}: references @/ee/ — use @/lib/sv/oss/* (clean-room)")
            for m in COPILOT_SERVICE.finditer(text):
                line = text.count("\n", 0, m.start()) + 1
                errors.append(f"{path.relative_to(root)}:{line}: proprietary copilot service reference '{m.group(0)}' (M01-T03)")
    return errors


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=ROOT)
    errors = run(ap.parse_args().root.resolve())
    for e in errors:
        print(f"studio-guards: {e}")
    print(f"studio-guards: {'FAIL' if errors else 'PASS'} ({len(errors)} violation(s))")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

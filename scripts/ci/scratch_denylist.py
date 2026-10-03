#!/usr/bin/env python3
"""Scratch opcode denylist guard (M01-T11, ADR-0004 clean-room, analysis/adr/scratch-opcode-denylist.md).

Fails when a string literal in SimVehicleApp-owned code equals a Scratch opcode name, i.e. matches a
pattern of analysis/adr/scratch-opcode-denylist.grep (ERE anchored on the whole identifier).
Scope: code we write (upstream Sim code is out of scope — it legitimately has strings like `event_type`):
  - modules/simvehicleapp-studio/apps/sim/{lib/sv, blocks/vehicle, app/api/sv, **/components/sv}
  - modules/simvehicleapp-core, simvehicleapp-contracts, simvehicleapp-orchestrator, simvehicleapp-ai,
    compiler-code-* (source, schemas, fixtures)
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DENYLIST = Path("analysis/adr/scratch-opcode-denylist.grep")
STUDIO = Path("modules/simvehicleapp-studio/apps/sim")
STUDIO_SV_DIRS = ["lib/sv", "blocks/vehicle", "app/api/sv"]
OWN_MODULES = [
    "simvehicleapp-core",
    "simvehicleapp-contracts",
    "simvehicleapp-orchestrator",
    "simvehicleapp-ai",
    "compiler-code-cpp",
    "compiler-code-python",
    "compiler-code-rust",
]
SKIP_DIRS = {"node_modules", ".next", ".git", "dist", "build", "vendor"}
EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".py", ".rs", ".cpp", ".hpp", ".h"}
STRING = re.compile(r"""(['"`])([A-Za-z0-9_]+)\1""")


def load_patterns(root: Path) -> list[re.Pattern]:
    lines = (root / DENYLIST).read_text().splitlines()
    return [re.compile(l.strip()) for l in lines if l.strip() and not l.startswith("#")]


def scan_roots(root: Path) -> list[Path]:
    roots = [root / STUDIO / d for d in STUDIO_SV_DIRS]
    studio = root / STUDIO
    if studio.is_dir():
        for dirpath, dirnames, _ in os.walk(studio):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            if Path(dirpath).name == "sv" and Path(dirpath).parent.name == "components":
                roots.append(Path(dirpath))
    roots += [root / "modules" / m for m in OWN_MODULES]
    return [r for r in roots if r.is_dir()]


def run(root: Path) -> list[str]:
    patterns = load_patterns(root)
    errors: list[str] = []
    for base in scan_roots(root):
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in filenames:
                path = Path(dirpath) / name
                if path.suffix not in EXT:
                    continue
                try:
                    text = path.read_text()
                except (UnicodeDecodeError, OSError):
                    continue
                for m in STRING.finditer(text):
                    if any(p.match(m.group(2)) for p in patterns):
                        line = text.count("\n", 0, m.start()) + 1
                        errors.append(f"{path.relative_to(root)}:{line}: '{m.group(2)}' is a Scratch opcode name (ADR-0004)")
    return errors


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=ROOT)
    errors = run(ap.parse_args().root.resolve())
    for e in errors:
        print(f"scratch-denylist: {e}")
    print(f"scratch-denylist: {'FAIL' if errors else 'PASS'} ({len(errors)} violation(s))")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

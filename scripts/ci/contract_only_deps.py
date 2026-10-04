#!/usr/bin/env python3
"""contract-only-deps (M00-T08, AGENTS §2.2, analysis/02 §4).

A module under modules/<m> may depend on another module only through the contracts module
(`@simvehicleapp/contracts`, `@simvehicleapp/service-kit`, `simvehicleapp-contracts`). Checked:
  - package.json dependency names `@simvehicleapp/*` and path specs (file:/link:/portal:); a `workspace:`
    dependency on a package declared inside the same module is allowed (e.g. core's `@simvehicleapp/vss`);
  - requirements*.txt / pyproject.toml / Cargo.toml path or package references to other modules;
  - JS/TS relative imports (import/export/require/import()) that resolve outside the module directory.
Exit code 1 with one line per violation.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = "simvehicleapp-contracts"
ALLOWED_NPM = {"@simvehicleapp/contracts", "@simvehicleapp/service-kit"}
ALLOWED_PY = {"simvehicleapp-contracts", "simvehicleapp_contracts"}
SKIP_DIRS = {"node_modules", ".next", ".turbo", ".git", "build", "dist", "coverage", ".venv", "__pycache__"}
JS_EXT = {".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"}
JS_IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"](\.{1,2}/[^'"]*)['"]""", re.M)
PATH_SPEC = re.compile(r"^(file|link|portal):(.+)$")
PY_PATH = re.compile(r"(?:^-e\s+|file://|@\s*file:)(\S+)")
PY_NAME = re.compile(r"^\s*([A-Za-z0-9_.-]+)")
PYPROJECT_PATH = re.compile(r"""(?:path\s*=\s*["']|file://)([^"'\s]+)""")
CARGO_PATH = re.compile(r"""path\s*=\s*["']([^"']+)["']""")


def inside(p: Path, base: Path) -> bool:
    try:
        p.resolve().relative_to(base.resolve())
        return True
    except ValueError:
        return False


def allowed_target(target: Path, module_dir: Path, modules_root: Path) -> bool:
    return inside(target, module_dir) or inside(target, modules_root / CONTRACTS)


def walk(module_dir: Path):
    for dirpath, dirnames, filenames in os.walk(module_dir):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            yield Path(dirpath) / f


def module_package_names(module_dir: Path) -> set[str]:
    names = set()
    for f in walk(module_dir):
        if f.name == "package.json":
            try:
                name = json.loads(f.read_text()).get("name")
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            if isinstance(name, str):
                names.add(name)
    return names


def check_package_json(path: Path, module_dir: Path, modules_root: Path, local_names: set[str] = frozenset()) -> list[str]:
    errors = []
    try:
        pkg = json.loads(path.read_text())
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        return [f"{path}: unreadable package.json ({e})"]
    for field in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        for name, spec in (pkg.get(field) or {}).items():
            if str(spec).startswith("workspace:") and name in local_names:
                continue
            if name.startswith("@simvehicleapp/") and name not in ALLOWED_NPM:
                errors.append(f"{path}: {field}.{name} — modules may only depend on {sorted(ALLOWED_NPM)}")
            m = PATH_SPEC.match(str(spec))
            if m and not m.group(2).startswith("@") and not allowed_target(path.parent / m.group(2), module_dir, modules_root):
                errors.append(f"{path}: {field}.{name} = {spec} points outside the module")
    return errors


def check_python_reqs(path: Path, module_dir: Path, modules_root: Path) -> list[str]:
    errors = []
    for n, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        m = PY_PATH.search(line)
        if m and not allowed_target(path.parent / m.group(1), module_dir, modules_root):
            errors.append(f"{path}:{n}: path dependency {m.group(1)} points outside the module")
        name = PY_NAME.match(line)
        if name and name.group(1).lower().startswith("simvehicleapp") and name.group(1).lower() not in ALLOWED_PY:
            errors.append(f"{path}:{n}: depends on {name.group(1)} — only simvehicleapp-contracts is allowed")
    return errors


def check_path_refs(path: Path, module_dir: Path, modules_root: Path, pattern: re.Pattern) -> list[str]:
    errors = []
    for n, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
        for m in pattern.finditer(line):
            if not allowed_target(path.parent / m.group(1), module_dir, modules_root):
                errors.append(f"{path}:{n}: path {m.group(1)} points outside the module")
    return errors


def check_js_imports(path: Path, module_dir: Path) -> list[str]:
    try:
        text = path.read_text()
    except UnicodeDecodeError:
        return []
    errors = []
    for m in JS_IMPORT.finditer(text):
        if not inside(path.parent / m.group(1), module_dir):
            line = text.count("\n", 0, m.start()) + 1
            errors.append(f"{path}:{line}: relative import {m.group(1)} escapes the module (use @simvehicleapp/contracts)")
    return errors


def run(root: Path) -> list[str]:
    modules_root = root / "modules"
    errors: list[str] = []
    for module_dir in sorted(p for p in modules_root.iterdir() if p.is_dir()):
        local_names = module_package_names(module_dir)
        for f in walk(module_dir):
            if f.name == "package.json":
                errors += check_package_json(f, module_dir, modules_root, local_names)
            elif re.match(r"requirements.*\.txt$", f.name):
                errors += check_python_reqs(f, module_dir, modules_root)
            elif f.name == "pyproject.toml":
                errors += check_path_refs(f, module_dir, modules_root, PYPROJECT_PATH)
            elif f.name == "Cargo.toml":
                errors += check_path_refs(f, module_dir, modules_root, CARGO_PATH)
            elif f.suffix in JS_EXT and not f.name.endswith(".d.ts"):
                errors += check_js_imports(f, module_dir)
    return [e.replace(str(root) + os.sep, "") for e in errors]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=ROOT)
    errors = run(ap.parse_args().root.resolve())
    for e in errors:
        print(f"contract-only-deps: {e}")
    print(f"contract-only-deps: {'FAIL' if errors else 'PASS'} ({len(errors)} violation(s))")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

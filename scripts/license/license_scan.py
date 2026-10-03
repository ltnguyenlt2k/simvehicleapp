#!/usr/bin/env python3
"""License scan (M00-T08, ADR-0004, license-compliance skill).

For every JS package of a module (package.json + bun.lock/package-lock.json, dependencies installed):
  - every installed package must have a whitelisted license (SPDX expression; OR = any, AND = all);
  - a non-whitelisted license is accepted only through license-exceptions.txt AND only when the package is
    not in the production dependency closure (dev-only, never shipped);
  - denylisted licenses (GPL family, SSPL, BUSL, Commons-Clause) are always rejected.
Also rejects forbidden IDE extensions (ms-vscode.cpptools*, Pylance — AGENTS §2.4).

Scope: every module with a JS lockfile, the Sim studio included since M1. Declared licenses that are missing or
ambiguous are corrected in license-overrides.txt (verified against the package's LICENSE file); approved
production exceptions carry a 5th column `prod` in license-exceptions.txt.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
EXCLUDED_MODULES: set[str] = set()  # studio included since M1 (2026-10-03)
DENY = re.compile(r"\b(A?GPL|SSPL|BUSL|BSL-1\.1)|Commons[- ]Clause", re.I)  # LGPL: per-package exception (ADR-0004 Notes)
FORBIDDEN_EXTENSIONS = re.compile(r"^(ms-vscode\.cpptools.*|ms-python\.vscode-pylance)$", re.I)
SKIP_DIRS = {"node_modules", ".git", ".next", ".turbo", "build", "dist"}


def read_list(path: Path) -> list[str]:
    return [l.strip() for l in path.read_text().splitlines() if l.strip() and not l.lstrip().startswith("#")]


ALIASES = {"MIT License": "MIT", "The MIT License": "MIT", "Apache 2.0": "Apache-2.0", "Apache License 2.0": "Apache-2.0"}


def license_of(pkg: dict, overrides: dict[str, str] | None = None) -> str:
    ident = f"{pkg.get('name')}@{pkg.get('version')}"
    if overrides and ident in overrides:
        return overrides[ident]
    lic = _declared_license(pkg)
    return ALIASES.get(lic, lic)


def _declared_license(pkg: dict) -> str:
    lic = pkg.get("license")
    if isinstance(lic, dict):
        lic = lic.get("type")
    if not lic and isinstance(pkg.get("licenses"), list):
        lic = " OR ".join(str(l.get("type", l)) if isinstance(l, dict) else str(l) for l in pkg["licenses"])
    return str(lic or "UNKNOWN")


def allowed(expr: str, whitelist: set[str]) -> bool:
    expr = expr.replace("(", " ").replace(")", " ")
    return any(all(t.strip() in whitelist for t in alt.split(" AND ")) for alt in re.split(r"\s+OR\s+", expr.strip()))


def is_package_dir(d: Path) -> bool:
    return d.parent.name == "node_modules" or (d.parent.name.startswith("@") and d.parent.parent.name == "node_modules")


def installed_packages(node_modules: Path):
    """Yield (package_dir, package.json dict) for every installed package, nested ones included."""
    for dirpath, dirnames, filenames in os.walk(node_modules):
        dirnames[:] = [x for x in dirnames if x not in (".bin", ".cache")]
        d = Path(dirpath)
        if "package.json" not in filenames or not is_package_dir(d):
            continue
        try:
            pkg = json.loads((d / "package.json").read_text())
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        if pkg.get("name") and pkg.get("version"):
            yield d, pkg


def resolve(name: str, from_dir: Path, stop: Path) -> Path | None:
    """Node resolution of a dependency name from a package directory."""
    d = from_dir
    while True:
        cand = d / "node_modules" / name
        if (cand / "package.json").exists():
            return cand
        if d == stop or d.parent == d:
            return None
        d = d.parent


def workspace_dirs(pkg_dir: Path, pkg: dict) -> list[Path]:
    """Workspace member packages (`workspaces: ["apps/*", ...]` or `{packages: [...]}`)."""
    patterns = pkg.get("workspaces") or []
    if isinstance(patterns, dict):
        patterns = patterns.get("packages") or []
    dirs = []
    for pattern in patterns:
        for d in sorted(pkg_dir.glob(pattern)):
            if (d / "package.json").is_file() and "node_modules" not in d.parts:
                dirs.append(d)
    return dirs


def prod_closure(pkg_dir: Path) -> set[Path]:
    """Production dependency closure of a package and, for a monorepo root, of every workspace member."""
    seen: set[Path] = set()
    root_pkg = json.loads((pkg_dir / "package.json").read_text())
    stack = [(pkg_dir, root_pkg)]
    stack += [(d, json.loads((d / "package.json").read_text())) for d in workspace_dirs(pkg_dir, root_pkg)]
    while stack:
        d, pkg = stack.pop()
        deps = {**(pkg.get("dependencies") or {}), **(pkg.get("optionalDependencies") or {})}
        for name in deps:
            r = resolve(name, d, pkg_dir)
            if r is None or r.resolve() in seen:
                continue
            seen.add(r.resolve())
            stack.append((r, json.loads((r / "package.json").read_text())))
    return seen


def js_package_dirs(root: Path):
    for module in sorted((root / "modules").iterdir()):
        if not module.is_dir() or module.name in EXCLUDED_MODULES:
            continue
        for dirpath, dirnames, filenames in os.walk(module):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            if "package.json" in filenames and ({"bun.lock", "package-lock.json"} & set(filenames)):
                yield Path(dirpath)


def scan_js(
    root: Path,
    whitelist: set[str],
    exceptions: set[tuple[str, str]],
    overrides: dict[str, str] | None = None,
    prod_exceptions: set[tuple[str, str]] | None = None,
) -> list[str]:
    errors = []
    for pkg_dir in js_package_dirs(root):
        rel = str(pkg_dir.relative_to(root))
        nm = pkg_dir / "node_modules"
        if not nm.is_dir():
            errors.append(f"{rel}: dependencies not installed (run `bun install --frozen-lockfile`) — scan cannot run")
            continue
        prod = prod_closure(pkg_dir)
        seen: set[tuple[str, str]] = set()
        for d, pkg in installed_packages(nm):
            ident = f"{pkg['name']}@{pkg['version']}"
            lic = license_of(pkg, overrides)
            if (ident, lic) in seen:
                continue
            seen.add((ident, lic))
            scope = "prod" if d.resolve() in prod else "dev"
            if allowed(lic, whitelist):
                continue
            if DENY.search(lic):
                errors.append(f"{rel}: {ident} ({scope}) license {lic} is denylisted (ADR-0004)")
            else:
                if scope == "dev" and (rel, ident) in exceptions:
                    continue
                if scope == "prod" and (rel, ident) in (prod_exceptions or set()):
                    continue
                hint = "" if scope == "prod" else " — add a reviewed entry to license-exceptions.txt if acceptable"
                errors.append(f"{rel}: {ident} ({scope}) license {lic} is not whitelisted{hint}")
    return errors


def scan_ide_extensions(root: Path) -> list[str]:
    errors = []
    for f in sorted((root / "modules").glob("*/**/extensions.txt")):
        for n, line in enumerate(f.read_text().splitlines(), 1):
            ext = line.split("#", 1)[0].strip()
            if ext and FORBIDDEN_EXTENSIONS.match(ext.split("@", 1)[0]):
                errors.append(f"{f.relative_to(root)}:{n}: extension {ext} is forbidden in code-server (AGENTS §2.4)")
    return errors


def run(root: Path, whitelist_file: Path, exceptions_file: Path, overrides_file: Path | None = None) -> list[str]:
    whitelist = set(read_list(whitelist_file))
    exceptions: set[tuple[str, str]] = set()
    prod_exceptions: set[tuple[str, str]] = set()
    for line in read_list(exceptions_file):
        parts = line.split("\t")
        if len(parts) < 4 or DENY.search(parts[2]):
            return [f"{exceptions_file.name}: invalid or denylisted entry: {line}"]
        if len(parts) >= 5 and parts[4].strip() == "prod":
            prod_exceptions.add((parts[0], parts[1]))
        else:
            exceptions.add((parts[0], parts[1]))
    overrides: dict[str, str] = {}
    if overrides_file and overrides_file.exists():
        for line in read_list(overrides_file):
            parts = line.split("\t")
            if len(parts) < 3:
                return [f"{overrides_file.name}: entry needs <name@version> <TAB> <SPDX> <TAB> <evidence>: {line}"]
            overrides[parts[0]] = parts[1]
    return scan_js(root, whitelist, exceptions, overrides, prod_exceptions) + scan_ide_extensions(root)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=ROOT)
    ap.add_argument("--whitelist", type=Path, default=HERE / "whitelisted-licenses.txt")
    ap.add_argument("--exceptions", type=Path, default=HERE / "license-exceptions.txt")
    ap.add_argument("--overrides", type=Path, default=HERE / "license-overrides.txt")
    a = ap.parse_args()
    errors = run(a.root.resolve(), a.whitelist, a.exceptions, a.overrides)
    for e in errors:
        print(f"license-scan: {e}")
    print(f"license-scan: {'FAIL' if errors else 'PASS'} ({len(errors)} violation(s))")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

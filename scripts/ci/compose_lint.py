#!/usr/bin/env python3
"""Compose lint (M00-T08, ADR-0005, ADR-0009, AGENTS §2.2/§2.10).

Checks, on the *resolved* model from `docker compose config --format json`:
  1. root docker-compose.yml and every module fragment are valid on their own (`config`);
  2. the root `include:` lists exactly the module fragments found on disk;
  3. no container mounts the Docker socket;
  4. every published port binds 127.0.0.1;
  5. a fragment's build contexts and bind mounts stay inside its module directory.
Exit code 1 with one line per violation.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ENV = Path(__file__).resolve().parent / "ci.env"
SOCKET = re.compile(r"docker\.sock")
NON_PATH_CONTEXT = re.compile(r"^(service:|docker-image:|oci-layout:|[a-z]+://|git@)")


def compose_config(files: list[Path], env_file: Path, project_dir: Path) -> tuple[dict | None, str]:
    cmd = ["docker", "compose", "--env-file", str(env_file), "--project-directory", str(project_dir)]
    for f in files:
        cmd += ["-f", str(f)]
    cmd += ["config", "--format", "json"]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        return None, p.stderr.strip()
    return json.loads(p.stdout), ""


def inside(path: str, base: Path) -> bool:
    try:
        Path(path).resolve().relative_to(base.resolve())
        return True
    except ValueError:
        return False


def check_model(model: dict, label: str, module_dir: Path | None) -> list[str]:
    errors: list[str] = []
    for name, svc in (model.get("services") or {}).items():
        where = f"{label}: service {name}"
        for vol in svc.get("volumes") or []:
            src = str(vol.get("source", "")) if isinstance(vol, dict) else str(vol)
            tgt = str(vol.get("target", "")) if isinstance(vol, dict) else ""
            if SOCKET.search(src) or SOCKET.search(tgt):
                errors.append(f"{where}: mounts the Docker socket ({src or tgt}) — forbidden (ADR-0005)")
            if module_dir and isinstance(vol, dict) and vol.get("type") == "bind" and not inside(src, module_dir):
                errors.append(f"{where}: bind mount {src} is outside modules/{module_dir.name}")
        for port in svc.get("ports") or []:  # resolved long syntax: {target, published, host_ip, ...}
            if port.get("published") and port.get("host_ip") != "127.0.0.1":
                errors.append(f"{where}: port {port['published']} binds {port.get('host_ip') or '0.0.0.0'} — must bind 127.0.0.1 (AGENTS §2.10)")
        build = svc.get("build")
        if module_dir and isinstance(build, dict):
            contexts = [build.get("context", "")] + list((build.get("additional_contexts") or {}).values())
            for ctx in contexts:
                if ctx and not NON_PATH_CONTEXT.match(ctx) and not inside(ctx, module_dir):
                    errors.append(f"{where}: build context {ctx} is outside modules/{module_dir.name} (AGENTS §2.2)")
    return errors


def root_includes(root_file: Path) -> list[str]:
    out, in_include = [], False
    for line in root_file.read_text().splitlines():
        if re.match(r"^include:\s*$", line):
            in_include = True
            continue
        if in_include:
            m = re.match(r"^\s+-\s+(?:path:\s*)?(\S+)", line)
            if m:
                out.append(m.group(1))
            elif line.strip() and not line.startswith((" ", "#")):
                in_include = False
    return out


def run(root: Path, env_file: Path) -> list[str]:
    errors: list[str] = []
    fragments = sorted(p for p in (root / "modules").glob("*/compose*.yaml"))
    root_file = root / "docker-compose.yml"

    listed = sorted(root_includes(root_file))
    found = sorted(str(p.relative_to(root)) for p in fragments)
    if listed != found:
        errors.append(f"docker-compose.yml include {listed} != module fragments on disk {found}")

    model, err = compose_config([root_file], env_file, root)
    if model is None:
        errors.append(f"docker-compose.yml: invalid: {err}")
    else:
        errors += check_model(model, "docker-compose.yml", None)

    for frag in fragments:
        label = str(frag.relative_to(root))
        model, err = compose_config([frag], env_file, frag.parent)
        if model is None:
            errors.append(f"{label}: invalid standalone (ADR-0009): {err}")
            continue
        errors += check_model(model, label, frag.parent)
    return errors


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=ROOT)
    ap.add_argument("--env-file", type=Path, default=DEFAULT_ENV)
    args = ap.parse_args()
    errors = run(args.root.resolve(), args.env_file.resolve())
    for e in errors:
        print(f"compose-lint: {e}")
    print(f"compose-lint: {'FAIL' if errors else 'PASS'} ({len(errors)} violation(s))")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

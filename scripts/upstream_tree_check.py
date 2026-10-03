#!/usr/bin/env python3
"""Compare a vendored folder with its pinned upstream GitHub tree (M01-T01 baseline / merge-base check, ADR-0003).

Reads the committed tree (`git ls-tree -r <rev>:<path>`), fetches the upstream tree once through the GitHub API, and
reports every path that is added, deleted, content-modified or mode-changed relative to the pin. Changes must be
declared: paths matching a glob in the allowlist file (one glob per line, `#` comments) are accepted, the rest fail.

  python3 scripts/upstream_tree_check.py --repo simstudioai/sim --commit ad0b8678… \\
      --path modules/simvehicleapp-studio --allow modules/simvehicleapp-studio/UPSTREAM_SYNC.allow
  --fix-modes   chmod tracked files whose content is identical but whose mode differs (git update-index --chmod)

GITHUB_TOKEN (optional) raises the API rate limit.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import os
import subprocess
import sys
import urllib.request


def upstream_tree(repo: str, commit: str) -> dict[str, tuple[str, str]]:
    headers = {"Accept": "application/vnd.github+json"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"

    def get(url: str) -> dict:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as r:
            return json.load(r)

    tree_sha = get(f"https://api.github.com/repos/{repo}/git/commits/{commit}")["tree"]["sha"]
    data = get(f"https://api.github.com/repos/{repo}/git/trees/{tree_sha}?recursive=1")
    if data.get("truncated"):
        sys.exit("upstream tree listing truncated by the GitHub API")
    return {e["path"]: (e["mode"], e["sha"]) for e in data["tree"] if e["type"] in ("blob", "commit")}


def local_tree(rev: str, path: str) -> dict[str, tuple[str, str]]:
    """Tree of `path` at `rev`, or in the index (staged state) when rev is INDEX."""
    if rev == "INDEX":
        out = subprocess.check_output(["git", "ls-files", "-s", "-z", "--", path])
        prefix = path.rstrip("/") + "/"
    else:
        out = subprocess.check_output(["git", "ls-tree", "-r", "-z", f"{rev}:{path}"])
        prefix = ""
    entries = {}
    for rec in out.decode().split("\0"):
        if rec:
            meta, name = rec.split("\t", 1)
            f = meta.split()  # ls-tree: "mode type sha"; ls-files -s: "mode sha stage"
            mode, sha = f[0], (f[1] if rev == "INDEX" else f[2])
            entries[name[len(prefix):]] = (mode, sha)
    return entries


def load_allow(path: str | None) -> list[str]:
    if not path:
        return []
    with open(path) as f:
        return [l.split("#", 1)[0].strip() for l in f if l.split("#", 1)[0].strip()]


Change = tuple[str, str]  # (kind, path)


def compare(up: dict[str, tuple[str, str]], lo: dict[str, tuple[str, str]]) -> tuple[list[Change], list[Change]]:
    """Changes of `lo` relative to `up`, plus (path, expected mode) for files that differ only by mode."""
    changes: list[Change] = []
    mode_only: list[Change] = []
    for p in sorted(set(up) | set(lo)):
        u, l = up.get(p), lo.get(p)
        if u == l:
            continue
        if u is None:
            changes.append(("added", p))
        elif l is None:
            changes.append(("deleted", p))
        elif u[1] != l[1]:
            changes.append(("modified", p))
        else:
            mode_only.append((p, u[0]))
            changes.append((f"mode {l[0]}->{u[0]} expected", p))
    return changes, mode_only


def undeclared_changes(changes: list[Change], allow: list[str]) -> list[Change]:
    return [(k, p) for k, p in changes if not any(fnmatch.fnmatchcase(p, g) for g in allow)]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--commit", required=True)
    ap.add_argument("--path", required=True, help="vendored folder in this repo")
    ap.add_argument("--rev", default="HEAD", help="commit-ish, or INDEX for the staged state")
    ap.add_argument("--allow", help="file of globs (relative to --path) for declared local changes")
    ap.add_argument("--fix-modes", action="store_true")
    ap.add_argument("--list", action="store_true", help="print every change, not only undeclared ones")
    a = ap.parse_args()

    up, lo = upstream_tree(a.repo, a.commit), local_tree(a.rev, a.path)
    allow = load_allow(a.allow)
    changes, mode_only = compare(up, lo)

    if a.fix_modes and mode_only:
        for p, mode in mode_only:
            flag = "+x" if mode == "100755" else "-x"
            subprocess.check_call(["git", "update-index", f"--chmod={flag}", f"{a.path}/{p}"])
            full = os.path.join(a.path, p)
            if os.path.exists(full):
                os.chmod(full, 0o755 if flag == "+x" else 0o644)
        print(f"fixed modes of {len(mode_only)} file(s) (staged)")
        changes = [c for c in changes if not c[0].startswith("mode ")]

    undeclared = undeclared_changes(changes, allow)
    for kind, p in changes if a.list else undeclared:
        print(f"{kind:28s} {p}")
    total = {k: sum(1 for c in changes if c[0].split()[0] == k) for k in ("added", "deleted", "modified", "mode")}
    print(f"{a.path} vs {a.repo}@{a.commit[:12]}: upstream {len(up)} files, local {len(lo)}; "
          f"changes {total}; undeclared {len(undeclared)} → {'FAIL' if undeclared else 'PASS'}")
    return 1 if undeclared else 0


if __name__ == "__main__":
    sys.exit(main())

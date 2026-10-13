#!/usr/bin/env python3
"""changes — which CI jobs a push or pull request needs (path-based job selection).

The repository runs on private-repo GitHub runners (2 vCPU / 7 GB RAM, billed minutes), so a job runs only
when a file it depends on changed. Module dependencies follow AGENTS §2.2: every module depends on
`simvehicleapp-contracts` only; the studio E2E also runs the core services (compiler, vss-catalog); the
backends' conformance reads the contracts fixtures; the toolchain/templates feed the three backends.

  python3 scripts/ci/changes.py --base <sha> [--head HEAD]   # prints `<job>=true|false` lines for $GITHUB_OUTPUT

Without a usable base (first push, force push, unknown sha) or when CI itself changed, every job runs.
"""
from __future__ import annotations

import argparse
import subprocess
import sys

JOBS = [
    "studio", "studio_image", "core", "core_image", "contracts", "cpp", "cpp_macos", "python", "rust",
    "agent", "orchestrator", "ai", "deps",
]

# (path prefix, jobs it triggers). A file matches every rule whose prefix it starts with.
RULES: list[tuple[str, set[str]]] = [
    # CI itself: rules, scripts and workflows — run everything.
    (".github/", set(JOBS)),
    ("scripts/ci/", set(JOBS)),
    # Contracts are the shared dependency of every module and of the golden/conformance fixtures.
    ("modules/simvehicleapp-contracts/", {"contracts", "core", "core_image", "studio", "studio_image", "cpp", "cpp_macos",
                                          "python", "rust", "agent", "orchestrator", "ai"}),
    ("modules/simvehicleapp-core/", {"core", "core_image", "studio_image"}),
    ("modules/simvehicleapp-studio/", {"studio", "studio_image"}),
    ("modules/compiler-code-cpp/", {"cpp", "cpp_macos", "core_image"}),
    ("modules/compiler-code-python/", {"python", "core_image"}),
    ("modules/compiler-code-rust/", {"rust"}),
    # Templates and toolchain images feed the backends (Python requirements, Rust templateSha, agent plans).
    ("modules/velocitas-stack/", {"agent", "cpp", "python", "rust"}),
    ("modules/simvehicleapp-orchestrator/", {"orchestrator"}),
    ("modules/simvehicleapp-ai/", {"ai"}),
    ("scripts/license/", {"deps"}),
]

# Dependency manifests: the license scan and the vulnerability scan rerun when any of them changes.
DEPENDENCY_FILES = ("bun.lock", "package.json", "requirements.txt", "Cargo.lock", "Cargo.toml", "conanfile.py", "conanfile.txt")


def jobs_for(paths: list[str]) -> dict[str, bool]:
    """Jobs needed for these changed paths."""
    needed: set[str] = set()
    for path in paths:
        for prefix, jobs in RULES:
            if path.startswith(prefix):
                needed |= jobs
        if path.rsplit("/", 1)[-1] in DEPENDENCY_FILES:
            needed.add("deps")
    return {job: job in needed for job in JOBS}


def changed_paths(base: str, head: str) -> list[str] | None:
    """Files changed between base and head, or None when the base is not a usable commit."""
    if not base or set(base) == {"0"}:
        return None
    ok = subprocess.run(["git", "cat-file", "-e", f"{base}^{{commit}}"], capture_output=True).returncode == 0
    if not ok:
        return None
    out = subprocess.run(["git", "diff", "--name-only", f"{base}...{head}"], capture_output=True, text=True)
    if out.returncode != 0:
        return None
    return [line for line in out.stdout.splitlines() if line]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="")
    ap.add_argument("--head", default="HEAD")
    args = ap.parse_args()
    paths = changed_paths(args.base, args.head)
    jobs = {job: True for job in JOBS} if paths is None else jobs_for(paths)
    reason = "no usable base: every job" if paths is None else f"{len(paths)} changed file(s)"
    print(f"changes: {reason}", file=sys.stderr)
    for job, run in jobs.items():
        print(f"{job}={'true' if run else 'false'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

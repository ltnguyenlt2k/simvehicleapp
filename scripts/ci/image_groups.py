#!/usr/bin/env python3
"""image_groups — deploy/image-groups.txt covers every image the compose stack builds, each in exactly one group (ADR-0051).

A release ships the prebuilt images by group (`scripts/sv pull`); an image missing from the list would make
`sv up --no-build` fail on the deploy host, an image in two groups would be downloaded twice.

  python3 scripts/ci/image_groups.py     # compares against `docker compose config --images` (every profile)
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GROUPS_FILE = ROOT / "deploy" / "image-groups.txt"
# Images this repository builds; everything else (databroker, mosquitto, pgvector…) is pulled from its registry.
OWN_PREFIX = "simvehicleapp/"
# Build-only image (profile `build`): consumed by other builds, never run.
BUILD_ONLY = {"simvehicleapp/contracts:dev"}


def parse_groups(text: str) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = {}
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        name, *images = line.split()
        if name in groups:
            raise ValueError(f"group {name} listed twice")
        groups[name] = images
    return groups


def problems(groups: dict[str, list[str]], compose_images: set[str]) -> list[str]:
    out: list[str] = []
    seen: dict[str, str] = {}
    for name, images in groups.items():
        if not images:
            out.append(f"group {name} has no image")
        for image in images:
            if image in seen:
                out.append(f"{image} is in groups {seen[image]} and {name}")
            seen[image] = name
    built = {i for i in compose_images if i.startswith(OWN_PREFIX)} - BUILD_ONLY
    out += [f"{i} is built by compose but in no group" for i in sorted(built - seen.keys())]
    out += [f"{i} (group {seen[i]}) is not a compose image" for i in sorted(seen.keys() - built)]
    return out


def compose_images() -> set[str]:
    cmd = ["docker", "compose", "--env-file", "scripts/ci/ci.env", "--profile", "python", "--profile", "rust",
           "--profile", "mock", "config", "--images"]
    return set(subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True, text=True).stdout.split())


def main() -> int:
    found = problems(parse_groups(GROUPS_FILE.read_text()), compose_images())
    for p in found:
        print(f"image-groups: {p}", file=sys.stderr)
    if not found:
        print("image-groups: every built image is in exactly one release group")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())

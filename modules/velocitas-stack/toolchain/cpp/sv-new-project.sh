#!/usr/bin/env bash
# Usage: sv-new-project <dest-dir>
# Creates a new Velocitas C++ app from the pinned template and initialises it OFFLINE
# using the caches baked into the image (packages in ~/.velocitas, conan in ~/.conan2).
set -euo pipefail
DEST=${1:?usage: sv-new-project <dest-dir>}
[ -e "$DEST/.velocitas.json" ] && { echo "[sv] $DEST already initialised"; exit 0; }
mkdir -p "$DEST"
cp -a "$SV_SEED_DIR"/. "$DEST"/
cd "$DEST"
# One Velocitas venv for every project (ADR-0051, same as the toolchain agent's init): link this project's
# ~/.velocitas/projects/md5(path)/pyvenv to the seed's instead of a new ~200 MB copy.
seed="$HOME/.velocitas/projects/$(printf %s "$SV_SEED_DIR" | md5sum | cut -c1-32)/pyvenv"
own="$HOME/.velocitas/projects/$(printf %s "$(pwd -P)" | md5sum | cut -c1-32)"
if [ -d "$seed" ] && [ ! -e "$own/pyvenv" ]; then mkdir -p "$own" && ln -s "$seed" "$own/pyvenv"; fi
velocitas init      # offline: packages already cloned; per-project cache keyed by md5(path)
echo "[sv] project ready at $DEST — build with ./build.sh"

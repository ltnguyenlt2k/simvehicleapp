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
velocitas init      # offline: packages already cloned; per-project cache keyed by md5(path)
echo "[sv] project ready at $DEST — build with ./build.sh"

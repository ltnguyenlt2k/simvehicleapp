#!/usr/bin/env bash
# M28 full flow on the real GUI inside robotics/recorder (Xvfb + headed Chromium, GPU via WSLg /dev/dxg when present).
# usage: scripts/video/run.sh <out-dir> [RECORD=0|1]   — resets the dog first (gateway API), exits non-zero on any failed check.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$(mkdir -p "$1" && cd "$1" && pwd)"; RECORD="${2:-1}"
python3 "$ROOT/scripts/dog_reset.py"
GPU=()
[[ -e /dev/dxg ]] && GPU=(--device /dev/dxg -v /usr/lib/wsl:/usr/lib/wsl:ro -e LD_LIBRARY_PATH=/usr/lib/wsl/lib -e GALLIUM_DRIVER=d3d12)
docker run --rm --network host --init --shm-size 1g -u "$(id -u):$(id -g)" -e HOME=/tmp "${GPU[@]}" \
  -e RECORD="$RECORD" -e STUDIO_URL="${STUDIO_URL:-http://localhost:3000}" ${UNTIL:+-e UNTIL="$UNTIL"} \
  -v "$OUT":/evidence -v "$ROOT/scripts/video/robot_full_flow.mjs":/opt/video/flow.mjs:ro robotics/recorder:local \
  sh -c 'xvfb-run -a -s "-screen 0 1600x900x24" sh -c "cd /opt/video && node flow.mjs"'

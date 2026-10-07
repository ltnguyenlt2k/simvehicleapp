#!/usr/bin/env bash
# M15-T09/T10: records the full-flow demo video on the running stack and writes docs/media/full-flow.{mp4,gif}.
#   scripts/sv demo-video                 record + encode
#   scripts/sv demo-video --encode-only   encode the last recordings again
# 1. Playwright (official image, as the current user) runs `@live full flow` with SV_DEMO=1 (captions, pauses, 1920×1080);
# 2. the studio, realtime, orchestrator, workspace and assistant restart, `@live-restart` checks everything is still there (also recorded);
# 3. ffmpeg (container) joins both recordings, shortens frozen waits (freezedetect) and encodes H.264 720p + a 4× GIF preview.
# Needs the dev stack up (`scripts/sv up`) with the offline AI provider (SV_AI_PROVIDER=fake) — nothing leaves the host.
set -euo pipefail
cd "$(dirname "$0")/.."
DC="docker compose"
PW_IMAGE=mcr.microsoft.com/playwright:v1.63.0-noble
FF_IMAGE=linuxserver/ffmpeg:latest
E2E=modules/simvehicleapp-studio/e2e
OUT=docs/media
env_of() { grep -E "^$1=" .env | tail -1 | cut -d= -f2-; }
STUDIO_URL=$(env_of SV_STUDIO_URL); STUDIO_URL=${STUDIO_URL:-http://localhost:3000}
if [[ "${1:-}" != --encode-only ]]; then
  [[ "$(env_of SV_AI_PROVIDER)" == fake ]] || { echo "demo-video: set SV_AI_PROVIDER=fake in .env (offline, deterministic assistant)"; exit 1; }
  curl -fsS -o /dev/null "$STUDIO_URL" || { echo "demo-video: studio not reachable at $STUDIO_URL — scripts/sv up"; exit 1; }

  rm -rf "$E2E/test-results" "$E2E/.state/full-flow.json"
  playwright() {
    docker run --rm --network host --user "$(id -u):$(id -g)" -e HOME=/tmp -e CI= \
      -e SV_STUDIO_URL="$STUDIO_URL" -e SV_IDE_PASSWORD="$(env_of SV_IDE_PASSWORD)" -e SV_DEMO=1 -e SV_REPO=/repo \
      -v "$PWD":/repo -w /repo/$E2E "$PW_IMAGE" \
      bash -c "npm install --no-audit --no-fund --silent && npx playwright test tests/m15-full-flow.spec.ts --grep '$1' --output test-results/$2"
  }
  playwright '@live full flow' 1-flow
  echo "demo-video: restarting the studio, realtime, orchestrator, workspace and assistant services"
  $DC restart studio studio-realtime orchestrator workspace ai-assistant >/dev/null
  for _ in $(seq 1 90); do curl -fsS -o /dev/null "$STUDIO_URL" && break; sleep 2; done
  playwright '@live-restart' 2-restart

fi
# the main tab of each test is `video.webm` (the IDE popup records its own `video-1.webm`)
mapfile -t clips < <(find "$E2E/test-results" -name 'video.webm' | sort)
[[ ${#clips[@]} -eq 2 ]] || { echo "demo-video: expected 2 recordings, found ${#clips[@]}"; exit 1; }
mkdir -p "$OUT"
list=$(mktemp -p "$E2E/test-results" concat.XXXX.txt)
for c in "${clips[@]}"; do echo "file '/repo/$c'" >> "$list"; done
ff() { docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/repo -w /repo --entrypoint ffmpeg "$FF_IMAGE" -hide_banner -loglevel error -y "$@"; }
ff -f concat -safe 0 -i "/repo/$list" -c:v libx264 -preset veryfast -crf 18 -an "$E2E/test-results/joined.mp4"
# Waits (project creation, build): every stretch frozen > 2.5 s keeps only its first 1.5 s (the caption stays readable).
freezes=$(docker run --rm -v "$PWD":/repo -w /repo --entrypoint ffmpeg "$FF_IMAGE" -hide_banner -i "$E2E/test-results/joined.mp4" \
  -vf "freezedetect=n=0.003:d=2.5,metadata=mode=print:file=-" -an -f null - 2>/dev/null | grep -E 'freeze_(start|end)=' || true)
keep=$(printf '%s\n' "$freezes" | python3 -c '
import sys
s = None; cuts = []
for line in sys.stdin:
    k, _, v = line.strip().partition("=")
    if k.endswith("freeze_start"): s = float(v)
    elif k.endswith("freeze_end") and s is not None: cuts.append(f"between(t,{s + 1.5:.2f},{float(v):.2f})"); s = None
print("+".join(cuts) or "0")')
ff -i "$E2E/test-results/joined.mp4" \
  -vf "select='not($keep)',setpts=N/25/TB,scale=1280:720:flags=lanczos,format=yuv420p" \
  -r 25 -c:v libx264 -preset slow -crf 26 -movflags +faststart -an "$OUT/full-flow.mp4"
ff -i "$OUT/full-flow.mp4" \
  -vf "setpts=0.25*PTS,fps=6,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer" \
  "$OUT/full-flow.gif"
ls -la "$OUT"/full-flow.*
echo "demo-video: wrote $OUT/full-flow.mp4 and $OUT/full-flow.gif"

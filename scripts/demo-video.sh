#!/usr/bin/env bash
# M15-T09/T10: records the full-flow demo video on the running stack and writes docs/media/full-flow.{mp4,gif}.
#   scripts/sv demo-video                 record + encode the full flow ⇒ docs/media/full-flow.{mp4,gif}
#   scripts/sv demo-video --tutorial      record + encode the tutorial "Overspeed warning" ⇒ docs/media/demo.{mp4,gif}
#   scripts/sv demo-video --showcase      record + encode every feature on two workflows (M21) ⇒ docs/media/showcase.{mp4,gif}
#                                         (starts a throwaway registry `sv-demo-registry` on sv-internal for the image push)
#   scripts/sv demo-video --encode-only   encode the last full-flow recordings again
# 1. Playwright (official image, as the current user) runs `@live full flow` with SV_DEMO=1 (captions, pauses, 1920×1080);
# 2. the studio, realtime, orchestrator, workspace and assistant restart, `@live-restart` checks everything is still there (also recorded);
# 3. ffmpeg (container) joins both recordings, shortens frozen waits (freezedetect) and encodes H.264 720p + a 4× GIF preview (8× for the showcase).
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
MODE=${1:-}
NAME=full-flow; CLIPS=2
[[ "$MODE" == --tutorial ]] && { NAME=demo; CLIPS=1; }
# Frozen stretches longer than FREEZE_MIN s keep only their first FREEZE_KEEP s. The showcase is recorded at a person's
# pace, so it only shortens real waits (project creation, build, push) and keeps the pauses for reading.
FREEZE_MIN=2.5; FREEZE_KEEP=1.5; GIF_PTS=0.25
[[ "$MODE" == --showcase ]] && { NAME=showcase; CLIPS=1; FREEZE_MIN=8; FREEZE_KEEP=3; GIF_PTS=0.125; }
if [[ "$MODE" != --encode-only ]]; then
  [[ "$(env_of SV_AI_PROVIDER)" == fake ]] || { echo "demo-video: set SV_AI_PROVIDER=fake in .env (offline, deterministic assistant)"; exit 1; }
  curl -fsS -o /dev/null "$STUDIO_URL" || { echo "demo-video: studio not reachable at $STUDIO_URL — scripts/sv up"; exit 1; }

  rm -rf "$E2E/test-results" "$E2E/.state/full-flow.json"
  playwright() {
    docker run --rm --network host --user "$(id -u):$(id -g)" -e HOME=/tmp -e CI= \
      -e SV_STUDIO_URL="$STUDIO_URL" -e SV_IDE_PASSWORD="$(env_of SV_IDE_PASSWORD)" -e SV_DEMO=1 -e SV_REPO=/repo \
      -v "$PWD":/repo -w /repo/$E2E "$PW_IMAGE" \
      bash -c "npm install --no-audit --no-fund --silent && npx playwright test tests/$3 --grep '$1' --output test-results/$2"
  }
  if [[ "$MODE" == --tutorial ]]; then
    playwright '@live tutorial' 1-tutorial tutorial-live.spec.ts
  elif [[ "$MODE" == --showcase ]]; then
    docker rm -f sv-demo-registry >/dev/null 2>&1 || true
    docker run -d --rm --name sv-demo-registry --network simvehicleapp_sv-internal registry:2 >/dev/null
    trap 'docker rm -f sv-demo-registry >/dev/null 2>&1 || true' EXIT
    playwright '@live showcase' 1-showcase m21-showcase.spec.ts
  else
  playwright '@live full flow' 1-flow m15-full-flow.spec.ts
  echo "demo-video: restarting the studio, realtime, orchestrator, workspace and assistant services"
  $DC restart studio studio-realtime orchestrator workspace ai-assistant >/dev/null
  for _ in $(seq 1 90); do curl -fsS -o /dev/null "$STUDIO_URL" && break; sleep 2; done
  playwright '@live-restart' 2-restart m15-full-flow.spec.ts
  fi

fi
# the main tab of each test is `video.webm` (the IDE popup records its own `video-1.webm`)
mapfile -t clips < <(find "$E2E/test-results" -name 'video.webm' | sort)
[[ ${#clips[@]} -eq $CLIPS ]] || { echo "demo-video: expected $CLIPS recordings, found ${#clips[@]}"; exit 1; }
mkdir -p "$OUT"
list=$(mktemp -p "$E2E/test-results" concat.XXXX.txt)
for c in "${clips[@]}"; do echo "file '/repo/$c'" >> "$list"; done
ff() { docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/repo -w /repo --entrypoint ffmpeg "$FF_IMAGE" -hide_banner -loglevel error -y "$@"; }
ff -f concat -safe 0 -i "/repo/$list" -c:v libx264 -preset veryfast -crf 18 -an "$E2E/test-results/joined.mp4"
# Waits (project creation, build): every stretch frozen > FREEZE_MIN s keeps only its first FREEZE_KEEP s (the caption stays readable).
freezes=$(docker run --rm -v "$PWD":/repo -w /repo --entrypoint ffmpeg "$FF_IMAGE" -hide_banner -i "$E2E/test-results/joined.mp4" \
  -vf "freezedetect=n=0.003:d=$FREEZE_MIN,metadata=mode=print:file=-" -an -f null - 2>/dev/null | grep -E 'freeze_(start|end)=' || true)
keep=$(printf '%s\n' "$freezes" | FREEZE_KEEP=$FREEZE_KEEP python3 -c '
import os, sys
keep = float(os.environ["FREEZE_KEEP"]); s = None; cuts = []
for line in sys.stdin:
    k, _, v = line.strip().partition("=")
    if k.endswith("freeze_start"): s = float(v)
    elif k.endswith("freeze_end") and s is not None: cuts.append(f"between(t,{s + keep:.2f},{float(v):.2f})"); s = None
print("+".join(cuts) or "0")')
ff -i "$E2E/test-results/joined.mp4" \
  -vf "select='not($keep)',setpts=N/25/TB,scale=1280:720:flags=lanczos,format=yuv420p" \
  -r 25 -c:v libx264 -preset slow -crf 26 -movflags +faststart -an "$OUT/$NAME.mp4"
ff -i "$OUT/$NAME.mp4" \
  -vf "setpts=$GIF_PTS*PTS,fps=6,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer" \
  "$OUT/$NAME.gif"
ls -la "$OUT"/$NAME.*
echo "demo-video: wrote $OUT/$NAME.mp4 and $OUT/$NAME.gif"

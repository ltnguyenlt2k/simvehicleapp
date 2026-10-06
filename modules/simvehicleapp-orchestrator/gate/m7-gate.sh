#!/usr/bin/env bash
# M7 acceptance gate on the running dev stack (scripts/sv up): real orchestrator, workspace,
# codegen-cpp and toolchain-cpp. Creates a fresh project; never removes volumes.
#   modules/simvehicleapp-orchestrator/gate/m7-gate.sh [slug]
set -euo pipefail
cd "$(dirname "$0")/../../.."
SLUG="${1:-gate-m7-$(date +%s)}"
NET=simvehicleapp_sv-internal
VOL=simvehicleapp_sv-workspace
HEADER="projects/$SLUG/app/src/simvehicleapp-runtime/include/simvehicleapp/rt/Runtime.hpp"
INTERNAL_API_SECRET="${INTERNAL_API_SECRET:-$(sed -n 's/^INTERNAL_API_SECRET=//p' .env)}"
export INTERNAL_API_SECRET SLUG

step() {
  docker run --rm --network "$NET" -e INTERNAL_API_SECRET -e SLUG -e STEP="$1" -e PREV="${PREV:-}" \
    -v "$PWD":/repo:ro -w /repo/modules/simvehicleapp-orchestrator oven/bun:1.3.8 bun gate/m7-gate.ts
}
workspace_with_fault() {
  SV_FAULT_AT="$1" docker compose up -d --no-deps workspace >/dev/null
  # The orchestrator resolves `workspace` again (the container IP changed).
  docker compose restart orchestrator >/dev/null
  until docker compose exec -T orchestrator bun -e 'process.exit((await fetch("http://127.0.0.1:4030/healthz").catch(()=>({ok:false}))).ok?0:1)' 2>/dev/null; do sleep 1; done
}
restore_header() {
  docker run --rm --user 4000:4000 -v "$VOL":/w alpine sed -i 's/void stableForRenamed(/void stableFor(/' "/w/$HEADER" || true
}

echo "== 1. GW-A + GW-B SynCode, idempotent second run, incremental build ($SLUG)"
step syncode

echo "== 2. workspace killed in the middle of a commit"
workspace_with_fault midSwap
OUT="$(step fault)"; echo "$OUT"
PREV="$(sed -n 's/^PREV=//p' <<<"$OUT")"
echo "   workspace container: $(docker inspect -f '{{.State.Status}} restarts={{.RestartCount}}' simvehicleapp-workspace-1)"
workspace_with_fault ""
PREV="$PREV" step recover

echo "== 3. intentional compile error (runtime API renamed in the project)"
trap restore_header EXIT
docker run --rm --user 4000:4000 -v "$VOL":/w alpine sed -i 's/void stableFor(/void stableForRenamed(/' "/w/$HEADER"
step broken
restore_header
trap - EXIT
echo "M7 gate: PASS ($SLUG)"

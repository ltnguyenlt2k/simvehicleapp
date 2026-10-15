#!/usr/bin/env bash
# M16 capacity gate (ADR-0053) on the running dev stack (scripts/sv up): quotas, SynCode queue, Clean measured with du,
# disk thresholds, repair, sweeper, delete — real orchestrator, workspace and toolchain-cpp. The orchestrator and the
# workspace are restarted with gate limits and restored on exit; the apps it creates are deleted on exit
# (SV_KEEP_APPS=1 keeps them). The gate never edits another app; POST /sweep does on the host's other apps what the
# hourly sweeper does anyway (failed apps older than SV_FAILED_TTL_DAYS, idle builds older than SV_IDLE_CLEAN_DAYS).
#   modules/simvehicleapp-orchestrator/gate/m16-capacity.sh [slug]
set -euo pipefail
cd "$(dirname "$0")/../../.."
SLUG="${1:-gate-m16-$(date +%s)}"
INTERNAL_API_SECRET="${INTERNAL_API_SECRET:-$(sed -n 's/^INTERNAL_API_SECRET=//p' .env)}"
export INTERNAL_API_SECRET SLUG
source scripts/lib/sv-apps.sh

step() {
  docker run --rm --network simvehicleapp_sv-internal -e INTERNAL_API_SECRET -e SLUG -e STEP="$1" \
    -v "$PWD":/repo:ro -w /repo/modules/simvehicleapp-orchestrator oven/bun:1.3.8 bun gate/m16-capacity.ts
}
healthy() {
  until docker compose exec -T "$1" bun -e "process.exit((await fetch('http://127.0.0.1:$2/healthz').catch(()=>({ok:false}))).ok?0:1)" 2>/dev/null; do sleep 1; done
}
# Recreates a service with extra environment (compose interpolates SV_* from it); no arguments = the .env values.
service_with() {
  local svc=$1 port=$2
  shift 2
  env "$@" docker compose up -d --no-deps "$svc" >/dev/null
  healthy "$svc" "$port"
}
sql() { docker compose exec -T studio-db psql -U postgres -d simvehicleapp -qAt -c "$1"; }
du_kb() { docker compose exec -T workspace du -sk "/workspace/projects/$1" | cut -f1; }
restore() {
  service_with workspace 4040 || true
  service_with orchestrator 4030 || true
  sv_delete_apps "$SLUG-a" "$SLUG-b" "$SLUG-c" "$SLUG-d"
}
trap restore EXIT

apps=$(docker compose exec -T orchestrator bun -e 'const r=await fetch("http://127.0.0.1:4030/capacity",{headers:{"x-sv-internal":process.env.INTERNAL_API_SECRET??""}});console.log((await r.json()).apps.total)')
echo "== 1. quotas: host limit set to $((apps + 2)) apps, 1 workflow per app ($SLUG)"
service_with orchestrator 4030 SV_MAX_APPS_TOTAL=$((apps + 2)) SV_MAX_WORKFLOWS_PER_APP=1
step create

echo "== 2. SynCode, one queued SynCode per app"
step build

echo "== 3. Clean (du before/after)"
before=$(du_kb "$SLUG-a")
step clean
after=$(du_kb "$SLUG-a")
echo "du $SLUG-a: ${before} KB → ${after} KB (−$(( (before - after) / 1024 )) MB)"
(( after < before )) || { echo "FAIL du did not shrink"; exit 1; }

echo "== 4. disk thresholds above the free space: creation and SynCode blocked"
service_with workspace 4040 SV_DISK_LOW_GB=1000000 SV_DISK_HIGH_GB=1000000 SV_DISK_FLOOD_GB=1000000
service_with orchestrator 4030 SV_MAX_APPS_TOTAL=$((apps + 3)) SV_MAX_WORKFLOWS_PER_APP=1
step disk
service_with workspace 4040
service_with orchestrator 4030 SV_MAX_APPS_TOTAL=$((apps + 2)) SV_MAX_WORKFLOWS_PER_APP=1

echo "== 5. repair a failed app"
sql "UPDATE sv.project SET status = 'failed', status_message = 'gate: simulated failure' WHERE slug = '$SLUG-b'"
step repair

echo "== 6. sweeper: a failed app older than SV_FAILED_TTL_DAYS is deleted"
sql "UPDATE sv.project SET status = 'failed', created_at = now() - interval '30 days', updated_at = now() - interval '30 days' WHERE slug = '$SLUG-b'"
step sweep

echo "== 7. delete"
step delete
echo "M16 capacity gate: PASS ($SLUG)"

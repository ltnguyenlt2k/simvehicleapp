#!/usr/bin/env bash
# M17 runtime gate (ADR-0057) on the running dev stack (scripts/sv up), images with sandboxes (scripts/sv refresh):
# two users run two apps at once, each on a databroker of its own (inject into one switches only its hazard), the
# per-user quota refuses a second app, Extend moves the time limit, a run stops by itself at its limit, and the
# toolchain reaps every databroker (no zombie). The orchestrator is restarted with gate limits (SV_RUN_SANDBOX=1,
# 45 s limit) and restored on exit; the gate's runs are stopped and its apps deleted on exit (SV_KEEP_APPS=1 keeps
# them). Other apps are not touched; restarting the orchestrator stops runs left active, as any restart does — run
# the gate when nobody runs an app.
#   modules/simvehicleapp-orchestrator/gate/m17-runtime.sh [slug]
set -euo pipefail
cd "$(dirname "$0")/../../.."
SLUG="${1:-gate-m17-$(date +%s)}"
INTERNAL_API_SECRET="${INTERNAL_API_SECRET:-$(sed -n 's/^INTERNAL_API_SECRET=//p' .env)}"
export INTERNAL_API_SECRET SLUG
source scripts/lib/sv-apps.sh

healthy() {
  until docker compose exec -T "$1" bun -e "process.exit((await fetch('http://127.0.0.1:$2/healthz').catch(()=>({ok:false}))).ok?0:1)" 2>/dev/null; do sleep 1; done
}
service_with() {
  local svc=$1 port=$2
  shift 2
  env "$@" docker compose up -d --no-deps "$svc" >/dev/null
  healthy "$svc" "$port"
}
brokers() { docker compose exec -T toolchain-cpp sh -c "ps -eo stat=,args= | grep -v grep | grep -c 'kuksa-databroker --insecure' || true"; }
zombies() { docker compose exec -T toolchain-cpp sh -c "ps -eo stat= | grep -c '^Z' || true"; }
restore() {
  sv_stop_runs "$SLUG-a" "$SLUG-b"
  sleep 6
  service_with orchestrator 4030 || true
  sv_delete_apps "$SLUG-a" "$SLUG-b"
}
trap restore EXIT

docker compose exec -T toolchain-cpp test -x /usr/local/bin/kuksa-databroker || { echo "FAIL toolchain-cpp has no databroker binary: run scripts/sv refresh"; exit 1; }
before=$(brokers)
echo "== sandboxes on: 1 run per user, 45 s limit, 1 extension ($SLUG; $before databroker(s) in toolchain-cpp before)"
service_with orchestrator 4030 SV_RUN_SANDBOX=1 SV_MAX_RUNS_PER_USER=1 SV_MAX_RUNS_TOTAL=5 SV_RUN_MAX_MINUTES=0.75 SV_RUN_MAX_EXTENSIONS=1
docker run --rm --network simvehicleapp_sv-internal -e INTERNAL_API_SECRET -e SLUG \
  -v "$PWD":/repo:ro -w /repo/modules/simvehicleapp-orchestrator oven/bun:1.3.8 bun gate/m17-runtime.ts
sleep 4
after=$(brokers)
z=$(zombies)
echo "databrokers in toolchain-cpp: $before before, $after after; zombies: $z"
(( after <= before )) || { echo "FAIL a sandbox databroker is still running"; exit 1; }
(( z == 0 )) || { echo "FAIL $z zombie process(es) in toolchain-cpp"; exit 1; }
echo "M17 runtime gate: PASS ($SLUG)"

#!/usr/bin/env bash
# Standalone services (ADR-0044 §1, M21 D9) on the running dev stack: a producer app publishes on MQTT, a consumer app
# sets the hazard lights; both run at once, each on a databroker of its own (ADR-0057), linked only by the MQTT topic.
# Two runs at once need sandboxes: the orchestrator is restarted with SV_RUN_SANDBOX=1 and restored on exit (this stops
# runs left active, as any restart does — run the gate when nobody runs an app).
#   modules/simvehicleapp-orchestrator/gate/two-apps-mqtt.sh [cpp|python|rust]
set -euo pipefail
cd "$(dirname "$0")/../../.."
LANG_ID="${1:-cpp}"
SLUG="gate-mqtt-$(date +%s)"
INTERNAL_API_SECRET="${INTERNAL_API_SECRET:-$(sed -n 's/^INTERNAL_API_SECRET=//p' .env)}"
export INTERNAL_API_SECRET SLUG LANG_ID
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
restore() {
  sv_stop_runs "$SLUG-producer" "$SLUG-consumer"
  sleep 3
  service_with orchestrator 4030 || true
  sv_delete_apps "$SLUG-producer" "$SLUG-consumer"
}
trap restore EXIT

service_with orchestrator 4030 SV_RUN_SANDBOX=1 SV_MAX_RUNS_PER_USER=2
docker run --rm --network simvehicleapp_sv-internal -e INTERNAL_API_SECRET -e SLUG -e LANG_ID \
  -v "$PWD":/repo:ro -w /repo/modules/simvehicleapp-orchestrator oven/bun:1.3.8 bun gate/two-apps-mqtt.ts
echo "Two apps over MQTT: PASS ($LANG_ID, $SLUG)"

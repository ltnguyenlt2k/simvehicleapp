#!/usr/bin/env bash
# M18-T10 gate (ADR-0060) on the running dev stack: SynCode GW-A (C++), push its OCI image to a registry on
# sv-internal without Docker in the toolchain, then pull it on the host and run it against the stack's databroker:
# the app must start (app.started). Removes its app, registry and container on exit.
#   modules/simvehicleapp-orchestrator/gate/m18-image.sh [cpp|rust]
set -euo pipefail
cd "$(dirname "$0")/../../.."
LANG_ID="${1:-cpp}"
SLUG="gate-image-$(date +%s)"
REG="sv-gate-registry-$$"
PORT="${SV_GATE_REGISTRY_PORT:-15000}"
INTERNAL_API_SECRET="${INTERNAL_API_SECRET:-$(sed -n 's/^INTERNAL_API_SECRET=//p' .env)}"
export INTERNAL_API_SECRET SLUG LANG_ID REG
source scripts/lib/sv-apps.sh
trap 'sv_delete_apps "$SLUG-$LANG_ID"; docker rm -f "$REG" "$SLUG-app" >/dev/null 2>&1 || true; docker image rm "127.0.0.1:$PORT/gate/$SLUG:1" >/dev/null 2>&1 || true' EXIT
docker run -d --rm --name "$REG" --network simvehicleapp_sv-internal -p "127.0.0.1:$PORT:5000" registry:2 >/dev/null
OUT=$(docker run --rm --network simvehicleapp_sv-internal -e INTERNAL_API_SECRET -e SLUG -e LANG_ID -e REG \
  -v "$PWD":/repo:ro -w /repo/modules/simvehicleapp-orchestrator oven/bun:1.3.8 bun gate/m18-image.ts)
echo "$OUT"
DIGEST=$(echo "$OUT" | sed -n 's/^DIGEST //p')
[ -n "$DIGEST" ] || { echo "FAIL no image digest"; exit 1; }
# The image as a vehicle would get it: pulled by digest, run against the databroker (the app's own process only).
docker pull -q "127.0.0.1:$PORT/gate/$SLUG@$DIGEST" >/dev/null
echo "ok pulled 127.0.0.1:$PORT/gate/$SLUG@$DIGEST ($(docker image inspect -f '{{.Size}}' "127.0.0.1:$PORT/gate/$SLUG@$DIGEST") bytes)"
docker run -d --name "$SLUG-app" --network simvehicleapp_sv-internal -e SDV_VEHICLEDATABROKER_ADDRESS=grpc://databroker:55555 \
  -e SDV_MQTT_ADDRESS=mqtt://mqtt:1883 -e KUKSA_DATABROKER_API=kuksa.val.v2 -e SV_DATABROKER_API=kuksa.val.v2 -e SV_TRACE_LEVEL=node \
  "127.0.0.1:$PORT/gate/$SLUG@$DIGEST" >/dev/null
for _ in $(seq 1 40); do
  if docker logs "$SLUG-app" 2>&1 | grep -q '"ev":"app.started"'; then echo "ok the image runs: app.started"; echo "M18 image gate: PASS ($LANG_ID, $SLUG)"; exit 0; fi
  sleep 0.5
done
docker logs "$SLUG-app" 2>&1 | tail -20
echo "FAIL the app did not start from its image"; exit 1

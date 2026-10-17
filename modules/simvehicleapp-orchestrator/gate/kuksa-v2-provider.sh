#!/usr/bin/env bash
# kuksa.val.v2 provider gate (ADR-0047 §2, M14 #5) on the running dev stack: the signal-gateway claims an actuator of
# the v4.0 databroker as its provider (PUT /mirror api kuksa.val.v2); a v2 Actuate is accepted and the value becomes
# current; a second provider is refused; releasing it makes Actuate UNAVAILABLE again. Releases the claim on exit.
#   modules/simvehicleapp-orchestrator/gate/kuksa-v2-provider.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
INTERNAL_API_SECRET="${INTERNAL_API_SECRET:-$(sed -n 's/^INTERNAL_API_SECRET=//p' .env)}"
export INTERNAL_API_SECRET
docker run --rm --network simvehicleapp_sv-internal -e INTERNAL_API_SECRET \
  -v "$PWD":/repo:ro -w /repo/modules/simvehicleapp-orchestrator/services/signal-gateway oven/bun:1.3.8 bun gate/kuksa-v2-provider.ts
echo "kuksa.val.v2 provider gate: PASS"

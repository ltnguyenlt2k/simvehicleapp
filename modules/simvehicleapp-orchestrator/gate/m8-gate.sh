#!/usr/bin/env bash
# M8 acceptance gate on the running dev stack (scripts/sv up): GW-A live run with the real toolchain,
# KUKSA databroker and signal-gateway. Creates a fresh project; never removes volumes.
#   modules/simvehicleapp-orchestrator/gate/m8-gate.sh [slug]
set -euo pipefail
cd "$(dirname "$0")/../../.."
SLUG="${1:-gate-m8-$(date +%s)}"
INTERNAL_API_SECRET="${INTERNAL_API_SECRET:-$(sed -n 's/^INTERNAL_API_SECRET=//p' .env)}"
export INTERNAL_API_SECRET SLUG
docker run --rm --network simvehicleapp_sv-internal -e INTERNAL_API_SECRET -e SLUG \
  -v "$PWD":/repo:ro -w /repo/modules/simvehicleapp-orchestrator oven/bun:1.3.8 bun gate/m8-gate.ts
echo "M8 gate (backend): PASS ($SLUG)"

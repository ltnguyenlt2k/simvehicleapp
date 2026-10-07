#!/usr/bin/env bash
# Parity P3 (ADR-0042, M11-T01) on the running dev stack (scripts/sv up): GW-A…G built by SynCode, run
# on the KUKSA databroker, scenarios played by the signal-gateway, traces compared with the goldens.
# Creates a fresh project; never removes volumes. Report: $SV_PARITY_REPORT (default parity-p3.json).
#   modules/simvehicleapp-orchestrator/gate/parity-p3.sh [GW-A,GW-C]       env SV_PARITY_LANGUAGE=python: the Python backend (M12)
set -euo pipefail
cd "$(dirname "$0")/../../.."
SLUG="parity-p3-$(date +%s)"
GOLDENS="${1:-}"
INTERNAL_API_SECRET="${INTERNAL_API_SECRET:-$(sed -n 's/^INTERNAL_API_SECRET=//p' .env)}"
out="${SV_PARITY_REPORT:-$PWD/parity-p3.json}"
mkdir -p "$(dirname "$out")"
export INTERNAL_API_SECRET SLUG GOLDENS
docker run --rm --network simvehicleapp_sv-internal --user "$(id -u):$(id -g)" -e HOME=/tmp -e INTERNAL_API_SECRET -e SLUG -e GOLDENS \
  -e SV_PARITY_DEBUG -e SV_PARITY_LANGUAGE -e SV_PARITY_REPORT=/out/$(basename "$out") -v "$(dirname "$out")":/out \
  -v "$PWD":/repo:ro -w /repo/modules/simvehicleapp-orchestrator oven/bun:1.3.8 bun gate/parity-p3.ts

#!/usr/bin/env bash
# M18-T09 gate (ADR-0060) on the running dev stack: an app deployed to a databroker "outside" the stack (a second KUKSA
# databroker on sv-internal, fed like a CAN provider would: Speed values, a provider for the hazard actuator) runs on
# the target's signals with no Signals tab; read-only refuses its writes (audited), read-write lets it switch the
# hazard; inject/Play are refused (SIMULATED_INPUT_DISABLED). Creates its app and target and removes them on exit.
#   modules/simvehicleapp-orchestrator/gate/m18-deploy.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
SLUG="gate-deploy-$(date +%s)"
TARGET="sv-gate-target-$$"
INTERNAL_API_SECRET="${INTERNAL_API_SECRET:-$(sed -n 's/^INTERNAL_API_SECRET=//p' .env)}"
export INTERNAL_API_SECRET SLUG TARGET
source scripts/lib/sv-apps.sh
trap 'sv_delete_apps "$SLUG"; docker rm -f "$TARGET" >/dev/null 2>&1 || true' EXIT
docker run -d --rm --name "$TARGET" --network simvehicleapp_sv-internal -v "$PWD/modules/velocitas-stack/vss":/vss:ro \
  ghcr.io/eclipse-kuksa/kuksa-databroker:0.7.1 --insecure --vss /vss/vss_rel_4.0.json >/dev/null
docker run --rm --network simvehicleapp_sv-internal -e INTERNAL_API_SECRET -e SLUG -e TARGET \
  -v "$PWD":/repo:ro -w /repo/modules/simvehicleapp-orchestrator oven/bun:1.3.8 bun gate/m18-deploy.ts
echo "M18 deploy gate: PASS ($SLUG)"

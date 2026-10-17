#!/usr/bin/env bash
# M18-T02/T03 gate (ADR-0058) on the running dev stack: SynCode GW-A with three test cases (the golden scenario, a
# scenario 1.1 case with `never`, a repeated name) for every backend; each case is a generated test that builds and
# passes in the real toolchain. Creates its apps and deletes them on exit (SV_KEEP_APPS=1 keeps them).
#   modules/simvehicleapp-orchestrator/gate/m18-test-cases.sh [cpp,python,rust]
set -euo pipefail
cd "$(dirname "$0")/../../.."
SLUG="gate-m18-$(date +%s)"
LANGS="${1:-cpp,python,rust}"
INTERNAL_API_SECRET="${INTERNAL_API_SECRET:-$(sed -n 's/^INTERNAL_API_SECRET=//p' .env)}"
export INTERNAL_API_SECRET SLUG LANGS
source scripts/lib/sv-apps.sh
trap 'sv_delete_apps $(for l in ${LANGS//,/ }; do echo "$SLUG-$l"; done)' EXIT
docker run --rm --network simvehicleapp_sv-internal -e INTERNAL_API_SECRET -e SLUG -e LANGS \
  -v "$PWD":/repo:ro -w /repo/modules/simvehicleapp-orchestrator oven/bun:1.3.8 bun gate/m18-test-cases.ts
echo "M18 test-cases gate: PASS ($SLUG)"

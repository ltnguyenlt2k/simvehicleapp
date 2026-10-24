#!/usr/bin/env bash
# Live check of an ADAS scenario workflow on the running dev stack (AGENTS.md §4 step 7: complex workflows on the real
# stack): SynCode a conformance ADAS workflow with its scenario as the test case (the generated test builds and passes
# in the toolchain), run the app, play the scenario on the databroker and check what the app really wrote.
#   modules/simvehicleapp-orchestrator/gate/adas-live.sh [cpp|python|rust] [conformance case, default C43-adas-forward-collision]
set -euo pipefail
cd "$(dirname "$0")/../../.."
LANG_ID="${1:-cpp}"
CASE="${2:-C43-adas-forward-collision}"
SLUG="gate-adas-$(date +%s)"
INTERNAL_API_SECRET="${INTERNAL_API_SECRET:-$(sed -n 's/^INTERNAL_API_SECRET=//p' .env)}"
export INTERNAL_API_SECRET SLUG LANG_ID CASE
source scripts/lib/sv-apps.sh
trap 'sv_delete_apps "$SLUG-$LANG_ID"' EXIT
docker run --rm --network simvehicleapp_sv-internal -e INTERNAL_API_SECRET -e SLUG -e LANG_ID -e CASE \
  -v "$PWD":/repo:ro -w /repo/modules/simvehicleapp-orchestrator oven/bun:1.3.8 bun gate/adas-live.ts
echo "ADAS live gate: PASS ($CASE, $LANG_ID, $SLUG)"

#!/usr/bin/env bash
# Custom VSS model gate (ADR-0052) on the running dev stack: adds the example overlay as a custom release, makes it
# live on databroker-custom, then per language lint → simulate → SynCode → Run + inject (phase 1); changes the model
# (a new signal) and SynCodes the same projects on it (phase 2). Creates fresh projects and deletes them on exit
# (SV_KEEP_APPS=1 keeps them); never removes volumes.
#   modules/simvehicleapp-orchestrator/gate/vss-custom-gate.sh [release] [langs]
set -euo pipefail
cd "$(dirname "$0")/../../.."
RELEASE="${1:-v4.0-acme}"
LANGS="${2:-cpp python rust}"
STAMP="$(date +%s)"
INTERNAL_API_SECRET="${INTERNAL_API_SECRET:-$(sed -n 's/^INTERNAL_API_SECRET=//p' .env)}"
export INTERNAL_API_SECRET RELEASE LANGS STAMP
source scripts/lib/sv-apps.sh
slugs() { local l; for l in $LANGS; do printf 'vss-%s-%s ' "$l" "$STAMP"; done; }
gate() {
  docker run --rm --network simvehicleapp_sv-internal -e INTERNAL_API_SECRET -e RELEASE -e LANGS -e STAMP -e PHASE="$1" \
    -v "$PWD":/repo:ro -w /repo/modules/simvehicleapp-orchestrator oven/bun:1.3.8 bun gate/vss-custom-gate.ts
}
scripts/sv vss add "$RELEASE" --overlay docs/examples/vss/overlay-acme.json
scripts/sv vss use "$RELEASE" >/dev/null
trap 'sv_delete_apps $(slugs)' EXIT
gate 1
# The model changes after the projects exist: one more actuator in the same overlay.
tmp="$(mktemp)"; trap 'rm -f "$tmp"; sv_delete_apps $(slugs)' EXIT
python3 - docs/examples/vss/overlay-acme.json "$tmp" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1]))
doc["Vehicle"]["children"]["Acme"]["children"]["Hmi"]["children"]["Chime"] = {
    "type": "actuator", "datatype": "boolean", "description": "Audible chime (added after the projects were created)."}
json.dump(doc, open(sys.argv[2], "w"))
PY
scripts/sv vss add "$RELEASE" --overlay "$tmp"
gate 2
echo "vss-custom gate: PASS ($RELEASE: $LANGS)"

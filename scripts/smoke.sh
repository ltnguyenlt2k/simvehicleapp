#!/usr/bin/env bash
# Full live smoke (M08-T10) on the running root compose stack: SynCode with the real toolchain (M7 gate:
# GW-A + GW-B pass, idempotent second run, workspace killed mid-commit, compile error on its block),
# then GW-A live (M8 gate: run, inject through the signal-gateway, Hazard on, trace n2 → n3, SSE resume,
# Stop < 5 s). Creates fresh projects; never removes volumes. Nightly in CI (.github/workflows/nightly.yml).
set -euo pipefail
cd "$(dirname "$0")/.."
stamp=$(date +%s)
modules/simvehicleapp-orchestrator/gate/m7-gate.sh "smoke-m7-$stamp"
modules/simvehicleapp-orchestrator/gate/m8-gate.sh "smoke-m8-$stamp"
echo "smoke: PASS (M7 SynCode + M8 GW-A live)"

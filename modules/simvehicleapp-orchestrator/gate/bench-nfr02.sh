#!/usr/bin/env bash
# NFR-02 benchmark (M11-T07) on the running dev stack (scripts/sv up): validate, simulate, SynCode
# first/incremental. Creates a fresh project; never removes volumes. Report: $SV_BENCH_REPORT.
set -euo pipefail
cd "$(dirname "$0")/../../.."
INTERNAL_API_SECRET="${INTERNAL_API_SECRET:-$(sed -n 's/^INTERNAL_API_SECRET=//p' .env)}"
out="${SV_BENCH_REPORT:-$PWD/bench-nfr02.json}"
mkdir -p "$(dirname "$out")"
export INTERNAL_API_SECRET
docker run --rm --network simvehicleapp_sv-internal --user "$(id -u):$(id -g)" -e HOME=/tmp -e INTERNAL_API_SECRET \
  -e SV_BENCH_REPORT="/out/$(basename "$out")" -v "$(dirname "$out")":/out \
  -v "$PWD":/repo:ro -w /repo/modules/simvehicleapp-orchestrator oven/bun:1.3.8 bun gate/bench-nfr02.ts

#!/usr/bin/env bash
# Runtime conformance P1 of the C++ backend (ADR-0042, M06-T09/T18): generate every golden and
# conformance case, build them with the runtime, run them on the mock vehicle, check the results.
#   generator/conformance/conformance.sh [--only ID]
# env: SV_CONF_JOBS (default 2), SV_CONF_BUILD_DIR, SV_CONF_CXXFLAGS (e.g. -fsanitize=address,undefined)
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
build=${SV_CONF_BUILD_DIR:-$here/../build/conformance}
jobs=${SV_CONF_JOBS:-2}
cd "$here"
bun conformance/run.ts prepare --build-dir "$build" "$@"
cmake -S "$build" -B "$build/out" -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_FLAGS="${SV_CONF_CXXFLAGS:-}" >/dev/null
cmake --build "$build/out" -j "$jobs"
rm -rf "$build/results" && mkdir -p "$build/results"
python3 - "$build" <<'PY'
import json, subprocess, sys
build = sys.argv[1]
for c in json.load(open(f"{build}/cases.json")):
    r = subprocess.run([f"{build}/out/{c['target']}", c["scenario"], c["runId"]], capture_output=True, text=True)
    if r.returncode == 0:
        open(f"{build}/results/{c['id']}.json", "w").write(r.stdout)
    else:
        print(f"{c['id']}: exit {r.returncode}\n{r.stderr}", file=sys.stderr)
    if c["golden"]:
        g = subprocess.run([f"{build}/out/gtest_{c['target']}"], capture_output=True, text=True)
        open(f"{build}/results/{c['id']}.gtest", "w").write(str(g.returncode))
        open(f"{build}/results/{c['id']}.gtest.log", "w").write(g.stdout + g.stderr)
PY
bun conformance/run.ts check --build-dir "$build" "$@"

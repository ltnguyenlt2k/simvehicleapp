#!/usr/bin/env bash
# Runtime conformance P1 of the Python backend (ADR-0042, M12-T03/T04): generate every golden and
# conformance case, run them with the runtime on the mock vehicle, run the generated pytest of the
# goldens, check the results.
#   generator/conformance/conformance.sh [--only ID]
# env: SV_CONF_BUILD_DIR, SV_PYTHON (default python3), SV_RUFF (ruff 0.9.10, the template's pin; when set,
#      every generated file must pass `ruff format --check` and `ruff check` — ADR-0040 §3)
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
build=${SV_CONF_BUILD_DIR:-$here/../build/conformance}
py=${SV_PYTHON:-python3}
cd "$here"
bun conformance/run.ts prepare --build-dir "$build" "$@"
rm -rf "$build/results" && mkdir -p "$build/results"
runtime=$(cd "$here/../runtime" && pwd)
"$py" - "$build" "$py" "$runtime" <<'PY'
import json, os, subprocess, sys
build, py, runtime = sys.argv[1], sys.argv[2], sys.argv[3]
env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONPATH=runtime)
for c in json.load(open(f"{build}/cases.json")):
    r = subprocess.run([py, "-I", f"{c['dir']}/driver.py", f"{c['dir']}/scenario.json", c["runId"], c["module"]], capture_output=True, text=True)
    if r.returncode == 0:
        open(f"{build}/results/{c['id']}.json", "w").write(r.stdout)
    else:
        open(f"{build}/results/{c['id']}.err", "w").write(r.stderr)
        print(f"{c['id']}: exit {r.returncode}\n{r.stderr[-2000:]}", file=sys.stderr)
    if c["golden"]:
        g = subprocess.run([py, "-m", "pytest", "-q", "-p", "no:cacheprovider", f"{c['dir']}/app/tests/generated"], capture_output=True, text=True, env=env)
        open(f"{build}/results/{c['id']}.pytest", "w").write(str(g.returncode))
        open(f"{build}/results/{c['id']}.pytest.log", "w").write(g.stdout + g.stderr)
PY
status=0
if [ -n "${SV_RUFF:-}" ]; then
  echo "ruff $("$SV_RUFF" --version) on the generated code of every case:"
  "$SV_RUFF" format --no-cache --check "$build"/cases/*/app || status=1
  "$SV_RUFF" check --no-cache "$build"/cases/*/app || status=1
fi
bun conformance/run.ts check --build-dir "$build" "$@" || status=1
exit $status

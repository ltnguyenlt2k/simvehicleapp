#!/usr/bin/env bash
# M9 acceptance gate on the running dev stack: Open IDE (tasks Build/Test/Run on stack in ide-cpp;
# SV_GATE_SKIP_IDE=1 skips them where no IDE runs),
# export (zip contents, determinism; SV_GATE_EXPORT_BUILD=1 also builds it with the template's
# app/Dockerfile like a clean machine would), license PDP enforced with a restricted test license.
#   modules/simvehicleapp-orchestrator/gate/m9-gate.sh [slug]
set -euo pipefail
cd "$(dirname "$0")/../../.."
SLUG="${1:-gate-m9-$(date +%s)}"
INTERNAL_API_SECRET="${INTERNAL_API_SECRET:-$(sed -n 's/^INTERNAL_API_SECRET=//p' .env)}"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/sv-m9.XXXXXX")"
export INTERNAL_API_SECRET SLUG
step() {
  docker run --rm --network simvehicleapp_sv-internal --user "$(id -u):$(id -g)" -e INTERNAL_API_SECRET -e SLUG -e STEP="$1" \
    -v "$PWD":/repo:ro -v "$OUT":/out -w /repo/modules/simvehicleapp-orchestrator oven/bun:1.3.8 bun gate/m9-gate.ts
}
orchestrator_with() {
  env "$@" docker compose up -d --no-deps orchestrator >/dev/null
  until docker compose exec -T orchestrator bun -e 'process.exit((await fetch("http://127.0.0.1:4030/healthz").catch(()=>({ok:false}))).ok?0:1)' 2>/dev/null; do sleep 1; done
}

echo "== 1. Open IDE: the project in code-server, tasks Build / Test / Run on stack"
step prepare | tee "$OUT/prepare.log"
EDITOR=$(sed -n 's/^EDITOR=//p' "$OUT/prepare.log")
if [[ "${SV_GATE_SKIP_IDE:-0}" == 1 ]]; then
  echo "skip the IDE checks (SV_GATE_SKIP_IDE=1: no ide-cpp in this stack)"
else
code=$(curl -s -o /dev/null -w '%{http_code}' "$EDITOR")
[[ "$code" =~ ^(200|302)$ ]] && echo "ok IDE answers on $EDITOR ($code, code-server login)" || { echo "FAIL IDE $EDITOR ⇒ $code"; exit 1; }
docker compose exec -T ide-cpp bash -lc "cd /workspace/projects/$SLUG && ./install_dependencies.sh >/tmp/m9-deps.log 2>&1 && ./build.sh >/tmp/m9-build.log 2>&1 && test -x build/bin/app && ! grep -q '^FAILED: ' /tmp/m9-build.log" \
  && echo "ok task 'SimVehicleApp: Build' passes in the IDE container" || { echo "FAIL IDE build (see /tmp/m9-build.log in ide-cpp)"; exit 1; }
docker compose exec -T ide-cpp bash -lc "cd /workspace/projects/$SLUG && for t in build/bin/app_generated_tests build/bin/app_utests; do if [ -x \"\$t\" ]; then \"\$t\" >/dev/null || exit 1; fi; done" \
  && echo "ok task 'SimVehicleApp: Test' passes" || { echo "FAIL IDE tests"; exit 1; }
run=$(docker compose exec -T ide-cpp bash -lc "cd /workspace/projects/$SLUG && timeout 6 sv-run-on-stack 2>&1 || true")
grep -q 'VSS v4.0 → grpc://databroker:55555' <<<"$run" && grep -q '"ev":"vdb.connected"' <<<"$run" && grep -q '"ev":"app.started"' <<<"$run" \
  && echo "ok task 'SimVehicleApp: Run on stack' connects to the databroker of the project's release (vdb.connected, app.started)" \
  || { echo "FAIL run on stack:"; echo "$run" | tail -20; exit 1; }
fi

echo "== 2. Export"
step export
if [[ "${SV_GATE_EXPORT_BUILD:-0}" == 1 ]]; then
  mkdir -p "$OUT/project" && python3 -m zipfile -e "$OUT/$SLUG.zip" "$OUT/project"
  chmod +x "$OUT/project"/*.sh 2>/dev/null || true
  docker build -q -f "$OUT/project/app/Dockerfile" -t "sv-export-$SLUG" "$OUT/project" >/dev/null \
    && echo "ok the exported project builds with the template's app/Dockerfile (outside SimVehicleApp)" || { echo "FAIL export build"; exit 1; }
  docker run --rm --entrypoint /app "sv-export-$SLUG" --help >/dev/null 2>&1 || true
  docker image rm -f "sv-export-$SLUG" >/dev/null 2>&1 || true
else
  echo "skip building the export (set SV_GATE_EXPORT_BUILD=1; the nightly CI does)"
fi

echo "== 3. License PDP (enforce + restricted license)"
step license > "$OUT/license.env"
trap 'orchestrator_with SV_LICENSE_MODE=full SV_LICENSE_KEY= SV_LICENSE_PUBLIC_KEY=' EXIT
orchestrator_with SV_LICENSE_MODE=enforce "SV_LICENSE_KEY=$(sed -n 's/^SV_LICENSE_KEY=//p' "$OUT/license.env")" "SV_LICENSE_PUBLIC_KEY=$(sed -n 's/^SV_LICENSE_PUBLIC_KEY=//p' "$OUT/license.env")"
step pdp
orchestrator_with SV_LICENSE_MODE=full SV_LICENSE_KEY= SV_LICENSE_PUBLIC_KEY=
trap - EXIT
rm -rf "$OUT"
echo "M9 gate: PASS ($SLUG)"

#!/usr/bin/env bash
# M06-T17/T18: real build of a generated project in the toolchain image (offline), then its tests.
#   generator/conformance/stage-project.sh            env: SV_TOOLCHAIN_IMAGE (default simvehicleapp/toolchain-cpp:dev)
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
stage=$here/../build/project-stage
rm -rf "$stage" && mkdir -p "$stage"
cd "$here" && bun conformance/stage-project.ts "$stage"
# The image user (vscode) owns the Velocitas/Conan caches; /stage is read-only, nothing is written to the host.
docker run --rm --memory 6g -e CMAKE_BUILD_PARALLEL_LEVEL=2 -e VELOCITAS_OFFLINE=1 -v "$stage":/stage:ro \
  --entrypoint sv-entrypoint "${SV_TOOLCHAIN_IMAGE:-simvehicleapp/toolchain-cpp:dev}" bash -c '
  set -euo pipefail
  p=/tmp/proj
  sv-new-project $p >/tmp/init.log 2>&1 || { cat /tmp/init.log; exit 1; }
  cd $p
  while read -r f; do [ -n "$f" ] && rm -f "$f"; done < /stage/remove.txt
  cp -a /stage/files/. $p/
  ./install_dependencies.sh >/tmp/deps.log 2>&1 || { tail -30 /tmp/deps.log; exit 1; }
  ./build.sh 2>&1 | grep -E "error|warning: unused|FAILED|Error" | head -40 || true
  # build.sh exits 0 even when the configure step fails (spike report M0): trust the artifacts.
  test -x build/bin/app || { echo "FAIL: build/bin/app missing"; exit 1; }
  test -x build/bin/app_generated_tests || { echo "FAIL: build/bin/app_generated_tests missing"; exit 1; }
  echo "ok build/bin/app and app_generated_tests built"
  ./build/bin/app_generated_tests
'

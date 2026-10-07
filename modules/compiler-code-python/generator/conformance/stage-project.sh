#!/usr/bin/env bash
# M12-T01/T04: a generated Python project in the toolchain image, OFFLINE (--network none): new project from the
# seed (velocitas init), overlay + runtime + the 7 goldens, then the agent's deps/build/test/format-check commands.
#   generator/conformance/stage-project.sh            env: SV_TOOLCHAIN_IMAGE (default simvehicleapp/toolchain-python:dev)
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
stage=$here/../build/project-stage
rm -rf "${stage:?}" && mkdir -p "$stage"
cd "$here" && bun conformance/stage-project.ts "$stage"
docker run --rm --network none --memory 4g -v "$stage":/stage:ro \
  --entrypoint sv-entrypoint "${SV_TOOLCHAIN_IMAGE:-simvehicleapp/toolchain-python:dev}" bash -c '
  set -euo pipefail
  p=/tmp/proj
  sv-new-project $p >/tmp/init.log 2>&1 || { tail -40 /tmp/init.log; exit 1; }
  cd $p
  while read -r f; do [ -n "$f" ] && rm -f "$f"; done < /stage/remove.txt
  cp -a /stage/files/. $p/
  export PYTHONPATH=$p/app/src:$p/app/src/simvehicleapp-runtime PYTHONDONTWRITEBYTECODE=1
  echo "== deps";   pip3 install -q -r app/requirements.txt -r app/tests/requirements.txt
  echo "== build";  python3 -m compileall -q app/src && python3 -m simvehicleapp_runtime.check_project .
  echo "== test";   python3 -m pytest -q -p no:cacheprovider -p simvehicleapp_runtime.pytest_gtest app/tests/generated | grep -E "^\[(==========|  PASSED  |  FAILED  )\]"
  echo "== format-check"; ruff format --no-cache --check app/src/generated app/tests/generated && ruff check --no-cache app/src/generated app/tests/generated
  echo "== app imports"; python3 -c "import sys; sys.argv=[\"x\"]; import velocitas_sdk.vehicle_app, simvehicleapp_runtime.velocitas; print(\"host ok\")"
  echo STAGE-OK'

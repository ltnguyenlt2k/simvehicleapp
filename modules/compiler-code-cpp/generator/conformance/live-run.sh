#!/usr/bin/env bash
# Live check of the generated app on the dev stack (KUKSA databroker 0.5.0 + Mosquitto), M06-T03:
# builds the staged goldens project (stage-project.sh) next to the stack, runs it, feeds Vehicle.Speed
# through databroker-cli and prints the app's SVTRACE lines. Needs the stack up (`docker compose up -d`).
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
stage=$here/../build/project-stage
[ -d "$stage/files" ] || { echo "run conformance/stage-project.sh first"; exit 1; }
net=${SV_NETWORK:-simvehicleapp_sv-internal}
name=sv-live-check
docker rm -f $name >/dev/null 2>&1 || true
docker run -d --name $name --memory 6g --network "$net" -e CMAKE_BUILD_PARALLEL_LEVEL=2 -e VELOCITAS_OFFLINE=1 \
  -e SDV_MIDDLEWARE_TYPE=native -e SDV_VEHICLEDATABROKER_ADDRESS=grpc://databroker:55555 -e SDV_MQTT_ADDRESS=mqtt://mqtt:1883 \
  -e SV_TRACE_LEVEL=trigger -v "$stage":/stage:ro --entrypoint sv-entrypoint "${SV_TOOLCHAIN_IMAGE:-simvehicleapp/toolchain-cpp:dev}" bash -c '
  set -e; p=/tmp/proj; sv-new-project $p >/tmp/init.log 2>&1; cd $p
  while read -r f; do [ -n "$f" ] && rm -f "$f"; done < /stage/remove.txt
  cp -a /stage/files/. $p/; ./install_dependencies.sh >/tmp/deps.log 2>&1; ./build.sh -t app >/tmp/build.log 2>&1
  test -x build/bin/app; echo READY; exec ./build/bin/app' >/dev/null
for i in $(seq 1 120); do docker logs $name 2>&1 | grep -q "app.started" && break; sleep 5; done
docker logs $name 2>&1 | grep -q "app.started" || { docker logs --tail 40 $name; exit 1; }
# databroker-cli is interactive (needs a terminal): `script` gives it one.
cli() {
  printf '%s\nquit\n' "$@" | script -qec "docker run --rm -it --network $net -e TERM=xterm ghcr.io/eclipse-kuksa/kuksa-databroker-cli:0.5.0 --server databroker:55555" /dev/null >/dev/null 2>&1 || true
}
cli "publish Vehicle.Speed 100"; sleep 1
cli "publish Vehicle.Speed 130"; sleep 4
docker logs $name > "$stage/live.log" 2>&1; grep -E "SVTRACE" "$stage/live.log" | sed "s/\x1b\[[0-9;]*m//g" | grep -vE "\"wf\":\"gw_e\"" | head -${SV_LINES:-60}
docker rm -f $name >/dev/null

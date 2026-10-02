#!/usr/bin/env bash
# M0 smoke (S-1 + S-2 + S-3) against the running root compose stack.
#  1. new Velocitas project created + initialised OFFLINE inside toolchain-cpp (VELOCITAS_OFFLINE=1)
#  2. build → artifact check (build.sh exit code is NOT trusted) → unit tests
#  3. run the app against databroker:55555 + mqtt:1883, inject Vehicle.Speed via kuksa.val.v1, expect MQTT publish
#  4. set-semantics probe (sdv.databroker.v1 SetDatapoints → actuator TARGET)
set -euo pipefail
cd "$(dirname "$0")/.."
DC="docker compose"; P=/workspace/projects/smoke-$(date +%s)
pass(){ echo "PASS $*"; }; fail(){ echo "FAIL $*"; exit 1; }
$DC up -d databroker mqtt toolchain-cpp >/dev/null
$DC exec -T toolchain-cpp bash -lc "sv-new-project $P >/tmp/init.log 2>&1" && pass "S-1 offline init $P" || fail "init (see /tmp/init.log in toolchain-cpp)"
$DC exec -T toolchain-cpp bash -lc "cd $P && ./install_dependencies.sh >/tmp/deps.log 2>&1; ./build.sh >/tmp/build.log 2>&1; test -x build/bin/app && test -f build/compile_commands.json" && pass "S-1 build artifact + compile_commands" || fail "build"
$DC exec -T toolchain-cpp bash -lc "cd $P && ./build/bin/app_utests >/tmp/utest.log 2>&1" && pass "unit tests" || fail "unit tests"
$DC exec -d toolchain-cpp bash -lc "cd $P && exec ./build/bin/app > /tmp/app.log 2>&1"; sleep 3
OUT=$(mktemp); ( $DC exec -T mqtt mosquitto_sub -h localhost -t sampleapp/currentSpeed -C 1 -W 20 > "$OUT" 2>&1 & ); sleep 1
docker build -q -t sv-spike-databroker-tester -f spikes/s2-s4-databroker/Dockerfile.tester spikes/s2-s4-databroker >/dev/null
docker run --rm --network simvehicleapp_sv-internal --entrypoint python sv-spike-databroker-tester -c \
  "from kuksa_client.grpc import VSSClient, Datapoint; c=VSSClient('databroker',55555); c.connect(); c.set_current_values({'Vehicle.Speed': Datapoint(77.0)}); c.disconnect()"
sleep 3; grep -q '"speed":77' "$OUT" && pass "S-2 app received injected Vehicle.Speed and published MQTT: $(cat $OUT)" || fail "S-2 no MQTT ($(cat $OUT))"
$DC exec -T toolchain-cpp bash -lc "pkill -INT -f build/bin/app || true"
docker run --rm --network simvehicleapp_sv-internal -e VDB_HOST=databroker sv-spike-databroker-tester >/tmp/claude-s3.log 2>&1 && pass "S-3 set semantics ($(tail -1 /tmp/claude-s3.log))" || { cat /tmp/claude-s3.log; fail "S-3"; }
echo "SMOKE OK"

#!/usr/bin/env bash
# Live gate of sv-wasm-host (M20-T03b) on the running dev stack: the echo guest on the real databroker
# (kuksa.val.v2) — first value marked initial, a change set through the signal-gateway arrives, a write is answered,
# lifecycle lines are printed. Needs target/release/sv-wasm-host (cargo build --release).
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$here/../.." && pwd)
secret=$(sed -n 's/^INTERNAL_API_SECRET=//p' "$repo/.env")
net=simvehicleapp_sv-internal
gw() { docker run --rm --network $net curlimages/curl:8.11.1 -fsS -H "x-sv-internal: $secret" -H 'content-type: application/json' "$@"; }
gw -X POST http://signal-gateway:4050/signals -d '{"release":"v4.0","path":"Vehicle.Speed","value":50,"field":"value"}' >/dev/null
out=$(mktemp)
docker run --rm --name sv-wasm-host-gate --network $net -e SDV_VEHICLEDATABROKER_ADDRESS=grpc://databroker:55555 \
  -e SDV_MQTT_ADDRESS=mqtt://mqtt:1883 -v "$here":/w:ro debian:bookworm-slim \
  /w/target/release/sv-wasm-host /w/gate/echo.wat >"$out" 2>&1 &
sleep 4
gw -X POST http://signal-gateway:4050/signals -d '{"release":"v4.0","path":"Vehicle.Speed","value":131,"field":"value"}' >/dev/null
sleep 3
docker stop -t 5 sv-wasm-host-gate >/dev/null
wait || true
cat "$out"
fail=0
check() { if grep -q -- "$2" "$out"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
check "initial value marked" '"value":50.0,"ts":[0-9]*,"initial":true\|"initial":true'
check "lifecycle vdb.connected" '"ev":"vdb.connected"'
check "lifecycle app.started" '"ev":"app.started"'
check "change delivered" '"value":131'
check "write answered" '"kind":"set_result"'
rm -f "$out"
exit $fail

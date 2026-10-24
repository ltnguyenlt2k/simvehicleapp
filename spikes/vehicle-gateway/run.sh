#!/usr/bin/env bash
# Runs the spike on sv-internal against the stack's databroker: read-only, then read-write.
set -euo pipefail
cd "$(dirname "$0")/../.."
docker run --rm --network simvehicleapp_sv-internal --user "$(id -u):$(id -g)" -e HOME=/tmp -e S="${INTERNAL_API_SECRET:-$(sed -n 's/^INTERNAL_API_SECRET=//p' .env)}" \
  -v "$PWD/spikes/vehicle-gateway":/spike:ro -v "$PWD/modules/simvehicleapp-orchestrator":/m:ro \
  -w /m oven/bun:1.3.8 bash -c '
    cp /spike/*.ts /tmp/ && ln -s /m/services/signal-gateway/node_modules /tmp/node_modules
    for mode in read-only read-write; do
      echo "== $mode"
      bun /tmp/proxy.ts 55560 databroker:55555 $mode & P=$!; sleep 1
      ( sleep 1.2; bun -e "await fetch(\"http://signal-gateway:4050/signals\",{method:\"POST\",headers:{\"x-sv-internal\":process.env.S,\"content-type\":\"application/json\"},body:JSON.stringify({release:\"v4.0\",path:\"Vehicle.Speed\",value:77,field:\"value\"})}).then(r=>console.log(\"inject Speed 77:\",r.status))" ) &
      bun /tmp/client.ts 127.0.0.1:55560
      kill $P; wait $P 2>/dev/null || true
    done'

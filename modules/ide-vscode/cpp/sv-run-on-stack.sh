#!/usr/bin/env bash
# "SimVehicleApp: Run on stack" (ADR-0028 §4): build/bin/app of the project in the current folder against the
# databroker of its VSS release (SV_DATABROKERS, ADR-0024 §6) and the stack's Mosquitto, with node-level trace.
set -euo pipefail
[ -x build/bin/app ] || { echo "build/bin/app is missing: run the task 'SimVehicleApp: Build' (or SynCode) first" >&2; exit 1; }
release=$(sed -n 's/.*"vssRelease": *"\(v[0-9][0-9.]*\)".*/\1/p' .simvehicleapp/project.json 2>/dev/null | head -1)
release=${release:-v4.0}
broker=$(tr ',' '\n' <<<"${SV_DATABROKERS:-v4.0=databroker:55555}" | sed -n "s/^${release//./\\.}=//p" | head -1)
[ -n "$broker" ] || { echo "the stack has no databroker for VSS ${release} (SV_DATABROKERS=${SV_DATABROKERS:-})" >&2; exit 1; }
export SDV_MIDDLEWARE_TYPE=native SDV_VEHICLEDATABROKER_ADDRESS="grpc://${broker}" SDV_MQTT_ADDRESS="${SDV_MQTT_ADDRESS:-mqtt://mqtt:1883}"
export SV_TRACE_LEVEL="${SV_TRACE_LEVEL:-node}"
echo "SimVehicleApp: VSS ${release} → ${SDV_VEHICLEDATABROKER_ADDRESS}, MQTT ${SDV_MQTT_ADDRESS}"
echo "Note: a Run started in the studio drives the same databroker — stop it there first (one app per signal)."
exec build/bin/app

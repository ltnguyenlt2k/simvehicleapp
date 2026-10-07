#!/usr/bin/env bash
set -euo pipefail
UD="$HOME/.local/share/code-server/User"
mkdir -p "$UD"
# SimVehicleApp defaults (clangd, read-only generated code, gdb launch) and tasks, unless the user changed them.
[ -f "$UD/settings.json" ] || cp /opt/sv/ide/settings/settings.json "$UD/settings.json"
[ -f "$UD/tasks.json" ] || cp /opt/sv/ide/settings/tasks.json "$UD/tasks.json"
exec sv-entrypoint code-server --bind-addr 0.0.0.0:8080 --auth "${SV_IDE_AUTH:-password}" \
  --extensions-dir /opt/sv/ide/extensions --disable-telemetry "$@"

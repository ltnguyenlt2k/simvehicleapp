#!/usr/bin/env bash
set -euo pipefail
UD="$HOME/.local/share/code-server/User"
mkdir -p "$UD"
[ -f "$UD/settings.json" ] || cp /opt/sv/ide/settings/settings.json "$UD/settings.json"
exec sv-entrypoint code-server --bind-addr 0.0.0.0:8080 --auth "${SV_IDE_AUTH:-password}" \
  --extensions-dir /opt/sv/ide/extensions --disable-telemetry "$@"

#!/usr/bin/env bash
# VELOCITAS_OFFLINE=1: pip only uses the baked wheelhouse (/opt/sv/wheels), never PyPI; velocitas
# package fetches fail gracefully (the CLI tolerates it, packages are baked in ~/.velocitas).
set -euo pipefail
if [ "${VELOCITAS_OFFLINE:-0}" = "1" ]; then
  export PIP_NO_INDEX=1
fi
[ -d "$HOME/.velocitas/packages" ] || echo "[sv] WARNING: ~/.velocitas has no packages (offline init will fail)" >&2
exec "$@"

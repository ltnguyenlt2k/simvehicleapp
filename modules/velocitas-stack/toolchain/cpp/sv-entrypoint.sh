#!/usr/bin/env bash
# VELOCITAS_OFFLINE=1:
#  - pip only uses the baked wheelhouse (/opt/sv/wheels), never PyPI
#  - git URL of the C++ SDK is rewritten to the baked bare mirror (sdk-installer always clones)
#  - velocitas package fetches fail gracefully (CLI tolerates), conan remotes are disabled
set -euo pipefail
if [ "${VELOCITAS_OFFLINE:-0}" = "1" ]; then
  export PIP_NO_INDEX=1
  export GIT_CONFIG_COUNT=1
  export GIT_CONFIG_KEY_0="url.file:///opt/sv/mirrors/vehicle-app-cpp-sdk.git.insteadOf"
  export GIT_CONFIG_VALUE_0="https://github.com/eclipse-velocitas/vehicle-app-cpp-sdk.git"
  # Conan: conancenter disabled (no network); an EMPTY local-recipes-index remote stays enabled
  # because `conan search` (used by sdk-installer) errors out when no remote is enabled at all.
  conan remote disable conancenter >/dev/null 2>&1 || true
  conan remote enable sv-offline >/dev/null 2>&1 || true
else
  conan remote enable conancenter >/dev/null 2>&1 || true
  conan remote disable sv-offline >/dev/null 2>&1 || true
fi
[ -d "$HOME/.velocitas/packages" ] || echo "[sv] WARNING: ~/.velocitas has no packages (offline init will fail)" >&2
exec "$@"

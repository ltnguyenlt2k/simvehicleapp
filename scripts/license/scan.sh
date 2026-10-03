#!/usr/bin/env bash
# License scan entrypoint (ADR-0004). Install module dependencies first (CI does this).
set -euo pipefail
exec python3 "$(dirname "$0")/license_scan.py" "$@"

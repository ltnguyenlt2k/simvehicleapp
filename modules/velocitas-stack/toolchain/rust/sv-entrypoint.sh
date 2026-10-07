#!/usr/bin/env bash
# toolchain-rust: cargo is offline by configuration (vendored sources in /opt/sv/cargo-vendor).
set -euo pipefail
exec "$@"

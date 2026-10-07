#!/usr/bin/env bash
# Module inventory and release lock (ADR-0002/0009, M11-T10): scripts/modules.sh list | lock [--release X] [--check]
exec python3 "$(dirname "$0")/modules.py" "$@"

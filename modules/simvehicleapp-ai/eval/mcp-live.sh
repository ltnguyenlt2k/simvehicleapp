#!/usr/bin/env bash
# MCP + every tool on the running dev stack, no LLM (M10 review): needs SV_MCP_TOKENS in .env with one token
# of scope "tools" and one with "tools" + "actions:auto". Creates a fresh project; never removes volumes.
set -euo pipefail
cd "$(dirname "$0")/../../.."
tokens=$(sed -n 's/^SV_MCP_TOKENS=//p' .env)
[[ -n "$tokens" ]] || { echo "set SV_MCP_TOKENS in .env (a read-only and an actions:auto token)"; exit 2; }
SV_MCP_TOKEN_RO=$(python3 -c 'import json,sys; print(next(t["token"] for t in json.loads(sys.argv[1]) if "actions:auto" not in t.get("scopes",[])))' "$tokens")
SV_MCP_TOKEN_AUTO=$(python3 -c 'import json,sys; print(next(t["token"] for t in json.loads(sys.argv[1]) if "actions:auto" in t.get("scopes",[])))' "$tokens")
INTERNAL_API_SECRET="${INTERNAL_API_SECRET:-$(sed -n 's/^INTERNAL_API_SECRET=//p' .env)}"
export SV_MCP_TOKEN_RO SV_MCP_TOKEN_AUTO INTERNAL_API_SECRET
docker run --rm --network simvehicleapp_sv-internal --user "$(id -u):$(id -g)" -e HOME=/tmp -e SV_MCP_TOKEN_RO -e SV_MCP_TOKEN_AUTO -e INTERNAL_API_SECRET \
  -v "$PWD":/repo:ro -w /repo/modules/simvehicleapp-ai oven/bun:1.3.8 bun eval/mcp-live.ts

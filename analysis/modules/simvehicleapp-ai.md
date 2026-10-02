# Module: `simvehicleapp-ai`

**Tầng:** L2 · **ADR:** 0030 · **Milestone:** M10
**Container:** `ai-assistant` :4300 (chat SSE + `/mcp`)

## Cấu trúc
```
src/
  providers/        # tách từ apps/sim/providers (anthropic, openai, gemini, ollama, openai-compatible) — giữ header Apache + NOTICE
  agent/            # loop: messages → tool calls → confirmations → final; max steps; streaming
  mcp-server/       # định nghĩa tool simvehicleapp (zod → JSON schema), Streamable HTTP, bearer auth, scopes
  mcp-client/       # kết nối SV_MCP_CLIENTS
  tools/            # vss_*, workflow_*, project_syncode, run_*, signal_set, diagnostics_explain (gọi catalog/compiler/orchestrator/gateway)
  prompts/          # system prompt + block catalog summary (sinh từ /blocks)
  store/            # conversation, message, tool_call, proposal (schema sv_ai)
test/ scripted-LLM fixtures (tool call kịch bản cố định)
```
## Contract
Cung cấp: `ai-assistant.v1.yaml`, MCP tool schemas, WorkflowPatch v1. Tiêu thụ: catalog, compiler, orchestrator, signal-gateway.

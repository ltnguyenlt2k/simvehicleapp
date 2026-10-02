# M10 — AI Assistant (chat) + MCP server/client

**Mục tiêu:** Chat sinh/sửa workflow bằng patch có preview, điều khiển validate/simulate/syncode/run có xác nhận; API key từ `.env`; MCP server cho agent ngoài; MCP client tới server ngoài.
**ADR:** 0030 · **Phụ thuộc:** M4 (validate), M5 (simulate), M8 (run tools)

## Tasks
| ID | Task | Test |
|---|---|---|
| M10-T01 | Quyết định: tách `apps/sim/providers` vs Vercel AI SDK (spike 1 ngày) → ghi ADR-0030 Notes | |
| M10-T02 | Provider adapter (anthropic, openai, gemini, ollama, openai-compatible), streaming + tool calling, cấu hình env | unit với mock HTTP |
| M10-T03 | Tool registry + MCP server (Streamable HTTP, bearer, scopes) — 12 tool v1 | MCP Inspector |
| M10-T04 | Agent loop (max steps, confirmation gate, cancel) + SSE `/chat` | scripted-LLM tests |
| M10-T05 | WorkflowPatch v1: apply-on-draft, validate, auto-fix loop | unit |
| M10-T06 | MCP client (`SV_MCP_CLIENTS`), namespace `ext.*`, confirmation mặc định | test với MCP server giả |
| M10-T07 | Store `sv_ai` + retention | |
| M10-T08 | Studio: Assistant panel (thay placeholder M1), streaming, tool call cards, confirmation cards, Patch preview diff trên canvas (Accept/Reject/Edit), auto-layout | Playwright với LLM giả |
| M10-T09 | System prompt + tóm tắt block catalog tự sinh; eval set 20 prompt (VI/EN) đo tỉ lệ patch valid | eval report |
| M10-T10 | Bảo mật: không key xuống browser, rate limit, redact option, egress chỉ ai-assistant | review |

## Gate
Prompt "Cảnh báo HMI khi pin dưới 20% lúc xe đang chạy" ⇒ patch hợp lệ tương đương GW-B (validate 0 error) với ≥ 1 provider thật; `run_start` yêu cầu xác nhận; eval ≥ 80% patch valid; không có đường LLM → codegen.

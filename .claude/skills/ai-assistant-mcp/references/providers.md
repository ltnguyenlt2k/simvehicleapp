# Provider và lifecycle MCP

Đây là yêu cầu thiết kế từ ADR-0030, không phải bằng chứng API hosted hiện tại. Khi implement provider, xác minh lại nguồn chính thức; đặc biệt các nhận định key Gemini có tính thời điểm.

## Provider — canonical format & lưu ý từng provider
- Canonical nội bộ = **content-block shape của Anthropic** (`text`/`tool_use`/`tool_result`); provider khác dịch response của mình về shape này, không có schema trung gian thứ hai.
- `anthropic`: gọi thẳng `@anthropic-ai/sdk`.
- `openai-compatible`: `POST {OPENAI_COMPAT_BASE_URL}/chat/completions` — dùng cho OpenAI/Azure/OpenRouter **hoặc server tự host/tunnel** (Ollama/LiteLLM/vLLM); đổi provider/key sau URL đó không cần sửa code.
- `gemini`: **bắt buộc native API** (`generativelanguage.googleapis.com/.../streamGenerateContent`, header `x-goog-api-key`) — **không** qua endpoint OpenAI-compatible của Google (key mới `AQ.` bị endpoint đó từ chối, key cũ `AIzaSy...` ngừng hoạt động ~2026-09).
- MCP client (nội bộ lẫn `ext.*`) mở theo từng lượt chat, header mang danh tính user đang chat, đóng ngay sau lượt — không pool dùng chung nhiều user.
- Rate limit theo user/session (`SV_AI_RATE_LIMIT_PER_MINUTE`, mặc định 20) — không theo IP, không dùng chung.

---
name: ai-assistant-mcp
description: Implement SimVehicleApp AI chat, providers, MCP tools or WorkflowPatch validation and confirmation; excludes deterministic codegen.
---

# AI Assistant & MCP

Tham chiếu: `analysis/09-ai-assistant-mcp.md` (§4a cơ chế xác nhận chi tiết), ADR-0030 (Notes 2026-10-02 có lý do cụ thể cho từng quy tắc dưới, đúc kết từ kiến trúc agent/MCP production thật).

## Ranh giới
- AI **chỉ** đề xuất `WorkflowPatch v1` và gọi tool; **không** sinh/sửa code C++/Python/Rust của project.
- Patch luôn được validate (compiler) trước khi hiển thị; user Accept/Edit mới apply (trừ `SV_AI_AUTO_APPLY_DRAFT=true` cho draft). Cho phép sửa nhẹ patch trước khi Accept — không bắt Reject-rồi-gõ-lại.
- API key chỉ trong env container `ai-assistant`; không gửi xuống browser; không log key.

## Phân loại tool & cơ chế xác nhận (bắt buộc đúng thứ tự)
- Mỗi tool gán **tĩnh** vào `SAFE_TOOL_NAMES` hoặc `SENSITIVE_TOOL_NAMES` trong registry — không suy luận từ tên. Tool tốn kém/khó hoàn tác dù không ghi (vd export, syncode) vẫn là `sensitive`.
- Tool `sensitive`: (1) kiểm `required` của JSON Schema **trước** — thiếu field ⇒ trả tool-error bình thường trong cùng lượt, **không** tạo pending action (tránh nuốt câu trả lời làm rõ của user); (2) đủ field ⇒ lưu `PendingAction` (TTL 15'), **chỉ 1 cái/hội thoại** (con trỏ `conversationId → actionId`); (3) có pending action ⇒ chặn tin nhắn mới, chỉ nhận confirm/cancel; (4) confirm nhận `editedInput?` — luôn ghi đè input LLM đề xuất.
- Kết quả tool có hệ quả cụ thể phải trả `structuredContent` máy đọc được (vd `run_start` → `{runId, editorUrl}`), không chỉ text.
- `MAX_TOOL_ITERATIONS` mặc định 6 (`SV_AI_MAX_TOOL_STEPS`). Reasoning/"extended thinking" mặc định **tắt** trong vòng tool-use (`SV_AI_THINK=false`) — đã quan sát thực tế làm chậm & hỏng kết quả ở vòng lặp có tool; chỉ cân nhắc bật cho tác vụ một-lượt không có tool.

## Provider / MCP lifecycle
Chỉ khi sửa provider hoặc kết nối MCP, đọc [references/providers.md](references/providers.md) và ADR-0030 liên quan. Xác minh API hosted tại lúc implement; không dùng lịch sử key/provider như sự thật vĩnh viễn.

## Thêm tool MCP
1. Định nghĩa zod schema input/output + mô tả rõ cho LLM. 2. Handler gọi service qua client contract (không truy cập DB/fs trực tiếp). 3. Xếp vào đúng 1 trong 2 tập `SAFE_TOOL_NAMES`/`SENSITIVE_TOOL_NAMES`; nếu sensitive, định nghĩa `structuredContent`. 4. Test với scripted-LLM + MCP Inspector (bao gồm case thiếu field bắt buộc). 5. Cập nhật bảng tool §4/§4a trong `analysis/09`.

## Test
Scripted LLM (tool call cố định) cho agent loop; Eval milestone theo phase (không chạy LLM trả phí mặc định mỗi task): 20 prompt đo % patch valid (mục tiêu ≥ 80%); test riêng cơ chế xác nhận (thiếu field, 1 pending/hội thoại, editedInput thắng, rate-limit theo user).

## Mở rộng sau này (P2)
Nếu thêm bề mặt chat khác (Slack/Zalo/Teams…): làm "relay mỏng" — mint token theo đúng quyền user, gọi lại chính API `/chat` SSE hiện có — **không** tạo bản sao agent loop thứ hai.

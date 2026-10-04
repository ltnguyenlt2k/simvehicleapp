# `sv_if` v1 — If / Else
Nguồn: [05 §2.5–2.7](../../../../../analysis/05-blocks-and-execution-model.md#25-flow-control), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md).

- **Opcode:** `control.branch`. Handle vào `target`; ra `then` (điều kiện true) và `else` (false). Không yield.
- **`condition`:** biểu thức boolean (không boolean ⇒ `TYPE_MISMATCH`, M4).
- Nhánh không nối ⇒ run kết thúc ở nhánh đó. Nối handle không tồn tại ⇒ `HANDLE_UNKNOWN`.

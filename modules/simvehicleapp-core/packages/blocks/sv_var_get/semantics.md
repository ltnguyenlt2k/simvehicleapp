# `sv_var_get` v1 — Get variable
Nguồn: [05 §2.5–2.7](../../../../../analysis/05-blocks-and-execution-model.md#25-flow-control), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md).

- **Opcode:** `state.get`. Bước thường: handle `target` → `source`/`error`. Không yield.
- **`name`:** biến khai báo ở panel Variables (M03-T09) với kiểu + giá trị đầu; không có ⇒ `EXPR_UNKNOWN_REF`.
- **Output:** `value` (kiểu của biến). Tương đương tham chiếu `<variable.name>` trong biểu thức.

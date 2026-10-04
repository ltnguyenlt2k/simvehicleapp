# `sv_var_set` v1 — Set variable
Nguồn: [05 §2.5–2.7](../../../../../analysis/05-blocks-and-execution-model.md#25-flow-control), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md).

- **Opcode:** `state.set`. Bước thường, không yield; ghi nguyên tử trên strand.
- **`name`:** biến đã khai báo; **`value`:** biểu thức cùng kiểu biến (khác ⇒ `TYPE_MISMATCH`; thu hẹp ⇒ `TYPE_NARROWING_REQUIRES_CAST`).
- Biến thuộc **app** (dùng chung giữa các run), khởi tạo bằng giá trị đầu khi app chạy.

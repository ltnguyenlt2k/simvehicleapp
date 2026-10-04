# `sv_on_condition` v1 — When condition becomes true (P1)
Nguồn: [05 §2](../../../../../analysis/05-blocks-and-execution-model.md#2-catalog-block-chi-tiết-v1), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md), [ADR-0013](../../../../../analysis/adr/ADR-0013-dataflow-and-expression-language.md).

- **Loại:** trigger; opcode `event.condition`; handle ra `source`.
- **`expr`:** biểu thức boolean SVX tham chiếu signal (`<Vehicle.…>`) hoặc biến; runtime tự subscribe mọi signal trong biểu thức.
- **Bắn theo cạnh lên:** khi giá trị đổi false → true (không bắn lại khi vẫn true). **`debounceMs`:** điều kiện phải giữ true đủ lâu.
- **`concurrency`:** mặc định `restart`. **Output:** `timestamp`.
- **Lỗi:** biểu thức không boolean ⇒ `TYPE_MISMATCH` (M4).

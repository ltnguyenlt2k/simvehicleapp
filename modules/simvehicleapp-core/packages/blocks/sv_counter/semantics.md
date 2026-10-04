# `sv_counter` v1 — Counter (P1)
Nguồn: [05 §2.5–2.7](../../../../../analysis/05-blocks-and-execution-model.md#25-flow-control), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md).

- **Opcode:** `state.counter`. Bước thường, không yield.
- **`name`:** biến số nguyên đã khai báo; **`op`:** `inc` (mặc định), `dec`, `reset` (về giá trị đầu); **`step`:** ≥ 1 (mặc định 1).
- **Output:** `value` sau thao tác (int32); tràn miền ⇒ kẹp + `VALUE_OUT_OF_RANGE` ở trace.

# `sv_constant` v1 — Constant
Nguồn: [05 §2](../../../../../analysis/05-blocks-and-execution-model.md#2-catalog-block-chi-tiết-v1), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md), [ADR-0013](../../../../../analysis/adr/ADR-0013-dataflow-and-expression-language.md).

- **Loại:** bước (category `logic`), opcode `const`: giá trị literal, compiler nhúng thẳng vào chỗ dùng; handle `target`/`source`/`error` như mọi bước.
- **`type`:** một trong 12 kiểu vô hướng VSS (mặc định `float`). **`value`:** literal kiểm theo `type` (int64/uint64 là chuỗi thập phân, ADR-0018 §7).
- **Output:** `value` có kiểu = `type`.

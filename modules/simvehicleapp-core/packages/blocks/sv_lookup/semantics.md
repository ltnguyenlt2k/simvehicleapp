# `sv_lookup` v1 — Lookup table (P1)
Nguồn: [05 §2](../../../../../analysis/05-blocks-and-execution-model.md#2-catalog-block-chi-tiết-v1), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md), [ADR-0013](../../../../../analysis/adr/ADR-0013-dataflow-and-expression-language.md).

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`value`:** biểu thức; **`table`:** danh sách `{when, then}` duyệt theo thứ tự, dòng đầu có `when == value` thắng; **`default`:** kết quả khi không dòng nào khớp.
- **Output:** `result` — kiểu chung của các `then` và `default` (khác kiểu ⇒ `TYPE_MISMATCH`, M4).

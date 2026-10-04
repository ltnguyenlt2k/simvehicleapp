# `sv_compare` v1 — Compare
Nguồn: [05 §2](../../../../../analysis/05-blocks-and-execution-model.md#2-catalog-block-chi-tiết-v1), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md), [ADR-0013](../../../../../analysis/adr/ADR-0013-dataflow-and-expression-language.md).

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`left`, `right`:** biểu thức; **`op`:** `>` `<` `>=` `<=` `==` `!=` (mặc định `>`). Tương đương SVX `left op right`.
- **Output:** `result` boolean.
- **Kiểu/đơn vị:** khác kiểu không so sánh được ⇒ `TYPE_MISMATCH`; cùng dimension khác đơn vị ⇒ compiler chèn đổi đơn vị; khác dimension ⇒ `UNIT_DIMENSION_MISMATCH` (M4). Mảng phải qua `len`/`at`/`contains` ⇒ `ARRAY_VALUE_REQUIRES_INDEXING`.

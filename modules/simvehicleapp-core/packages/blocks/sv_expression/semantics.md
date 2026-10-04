# `sv_expression` v1 — Expression
Nguồn: [05 §2](../../../../../analysis/05-blocks-and-execution-model.md#2-catalog-block-chi-tiết-v1), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md), [ADR-0013](../../../../../analysis/adr/ADR-0013-dataflow-and-expression-language.md).

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`expr`:** biểu thức SVX đầy đủ (toán tử, hàm whitelist, template, tham chiếu `<…>`).
- **Output:** `result` — kiểu do typer suy ra (ADR-0015, M4).
- **Lỗi (lint/compile):** cú pháp ⇒ `EXPR_SYNTAX`; hàm lạ ⇒ `EXPR_UNKNOWN_FUNCTION`; tham chiếu không tồn tại ⇒ `EXPR_UNKNOWN_REF`; tham chiếu block chưa chắc chạy trước ⇒ `DATA_REF_NOT_DOMINATING`.

# `sv_math` v1 — Math
Nguồn: [05 §2](../../../../../analysis/05-blocks-and-execution-model.md#2-catalog-block-chi-tiết-v1), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md), [ADR-0013](../../../../../analysis/adr/ADR-0013-dataflow-and-expression-language.md).

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`op`:** `+ - * / %`, `min`, `max` (dùng `a` và `b`), `abs`, `round`, `floor`, `ceil` (chỉ `a`). Mặc định `+`.
- **`a`, `b`:** biểu thức số; `b` bắt buộc với toán tử hai ngôi (kiểm ở compiler).
- **Output:** `result` — kiểu suy luận (số nguyên + số nguyên ⇒ kiểu rộng hơn; có float/double ⇒ double, ADR-0015).
- **Edge case:** chia/mod cho 0 với số nguyên ⇒ nhánh `error` của bước (không UB); với số thực theo IEEE-754.

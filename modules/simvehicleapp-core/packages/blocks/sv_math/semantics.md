# `sv_math` v1 — Math
Nguồn: [05 §2](../../../../../analysis/05-blocks-and-execution-model.md#2-catalog-block-chi-tiết-v1), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md), [ADR-0013](../../../../../analysis/adr/ADR-0013-dataflow-and-expression-language.md).

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`op`:** `+ - * / %`, `min`, `max` (dùng `a` và `b`), `abs`, `round`, `floor`, `ceil` (chỉ `a`). Mặc định `+`.
- **`a`, `b`:** biểu thức số; `b` bắt buộc với toán tử hai ngôi (kiểm ở compiler).
- **Output:** `result` — kiểu suy luận (ADR-0015 Notes §7): `+ − ×` trên số nguyên ⇒ `int64` với miền tính được (miền vượt int64 ⇒ `TYPE_MISMATCH`, không bao giờ tràn lúc chạy); có float/double ⇒ `double`; `/` và `%` luôn ⇒ `double`.
- **Edge case:** `/` và `%` tính trên double theo IEEE-754 (`%` = `fmod`, dấu theo số bị chia): chia/mod cho 0 ⇒ ±Inf/NaN, giống nhau ở mọi backend (không có chia nguyên nên không có UB). *(Sửa 2026-10-06: bản trước ghi "chia nguyên cho 0 ⇒ nhánh error", trái ADR-0015 Notes §7.)*

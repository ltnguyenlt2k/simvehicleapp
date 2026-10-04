# `sv_bool` v1 — And / Or / Not / Xor
Nguồn: [05 §2](../../../../../analysis/05-blocks-and-execution-model.md#2-catalog-block-chi-tiết-v1), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md), [ADR-0013](../../../../../analysis/adr/ADR-0013-dataflow-and-expression-language.md).

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`op`:** `and` (mặc định), `or`, `not`, `xor`. **`inputs`:** danh sách biểu thức boolean (`not` dùng đúng 1 phần tử; `xor` = số phần tử true là lẻ).
- **Output:** `result` boolean. `and`/`or` đánh giá ngắn mạch theo thứ tự danh sách.
- **Lỗi:** phần tử không boolean ⇒ `TYPE_MISMATCH` (M4).

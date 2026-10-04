# `sv_array_at` v1 — Array element at
Nguồn: [ADR-0018 §4–6](../../../../../analysis/adr/ADR-0018-vss-array-and-full-datatype-coverage.md).

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`array`:** biểu thức `T[]`; **`index`:** biểu thức số nguyên (int32; không nguyên ⇒ `ARRAY_INDEX_TYPE_INVALID`); **`default`** (tuỳ chọn): giá trị khi index ngoài phạm vi.
- **Output:** `value` kiểu phần tử `T` (opcode IR `array.at`).
- **Ngoài phạm vi (runtime):** có `default` ⇒ trả `default` + trace `ARRAY_INDEX_OUT_OF_RANGE` mức warn; không có ⇒ nhánh `error` của bước. Không bao giờ truy cập ngoài biên.

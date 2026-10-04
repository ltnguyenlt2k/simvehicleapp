# `sv_array_length` v1 — Array length
Nguồn: [ADR-0018 §5](../../../../../analysis/adr/ADR-0018-vss-array-and-full-datatype-coverage.md).

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`array`:** biểu thức kiểu `T[]` (vd `<Vehicle.OBD.PidsA>`). Không phải mảng ⇒ `TYPE_MISMATCH`.
- **Output:** `length` uint32 (opcode IR `array.len`, gộp vào biểu thức).

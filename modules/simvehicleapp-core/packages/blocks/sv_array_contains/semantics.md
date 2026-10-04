# `sv_array_contains` v1 — Array contains (P1)
Nguồn: [ADR-0018 §5](../../../../../analysis/adr/ADR-0018-vss-array-and-full-datatype-coverage.md).

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`array`:** biểu thức `T[]`; **`value`:** literal/ref cùng kiểu phần tử (khác ⇒ `ARRAY_ELEMENT_TYPE_MISMATCH`).
- **Output:** `result` boolean (opcode IR `array.contains`).

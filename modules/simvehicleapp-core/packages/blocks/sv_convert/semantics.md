# `sv_convert` v1 — Convert unit/type (P1)
Nguồn: [05 §2](../../../../../analysis/05-blocks-and-execution-model.md#2-catalog-block-chi-tiết-v1), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md), [ADR-0013](../../../../../analysis/adr/ADR-0013-dataflow-and-expression-language.md).

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`value`:** biểu thức; **`to`:** đơn vị VSS đích (vd `m/s`, `kPa`) hoặc kiểu đích (vd `uint8`). Số thực ⇒ số nguyên: làm tròn gần nhất (0,5 ra xa 0), `NaN` ⇒ 0, rồi kẹp vào miền kiểu đích (và min/max VSS khi ghi) — giống nhau ở mọi backend (ADR-0014 Notes §11).
- **Đổi đơn vị:** chỉ trong cùng dimension (bảng `units.yaml`/`quantities.yaml` của release); khác dimension ⇒ `UNIT_DIMENSION_MISMATCH`.
- **Đổi kiểu thu hẹp:** tường minh, có kẹp miền; đây là cách người dùng xử lý `TYPE_NARROWING_REQUIRES_CAST`.
- **Output:** `result` có kiểu/đơn vị đích.

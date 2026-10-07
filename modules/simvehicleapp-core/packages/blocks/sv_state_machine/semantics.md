# `sv_state_machine` v1 — State machine

Nguồn: [ADR-0049](../../../../../analysis/adr/ADR-0049-filter-state-machine-subworkflow.md) §2, [05 §2.6](../../../../../analysis/05-blocks-and-execution-model.md#26-state).

- **Loại:** bước (category `state`, P2); handle vào `target`, ra `changed` (một chuyển trạng thái đã xảy ra) và
  `unchanged` (không dòng nào khớp).
- **Opcode:** `control.branch` — compiler desugar: với mỗi dòng một `control.branch` (điều kiện
  `<biến> == from && when`) và một `state.set` (gán `to`), không opcode riêng.
- **`name`:** biến workflow giữ trạng thái (khai báo ở panel Variables, kiểu chuỗi hoặc số nguyên thường dùng); biến
  chưa khai báo ⇒ `BLOCK_PROPERTY_INVALID`.
- **`transitions`:** danh sách dòng xét **theo thứ tự**, dòng đầu tiên khớp thắng (mỗi lần chạy tối đa một chuyển):
  - `from` — giá trị trạng thái hiện tại (biểu thức, cùng kiểu biến); trống = mọi trạng thái.
  - `when` — điều kiện boolean (có thể dùng `<Vehicle.…>`, output block khác, biến).
  - `to` — trạng thái mới (biểu thức, cùng kiểu biến).
  Thiếu `when`/`to` ⇒ `BLOCK_PROPERTY_MISSING`; kiểu không khớp ⇒ `TYPE_MISMATCH`.
- **Outputs:** không — đọc trạng thái bằng biến (`Get variable` hoặc ref biến).
- **Lỗi:** biểu thức không tính được ⇒ như If/Set variable (log + đi tiếp nhánh mặc định của node đó).
- **Side-effect:** ghi biến `name`.

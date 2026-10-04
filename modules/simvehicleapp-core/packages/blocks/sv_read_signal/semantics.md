# `sv_read_signal` v1 — Read ⟨signal⟩

Nguồn: [05 §2.2](../../../../../analysis/05-blocks-and-execution-model.md#22-sensors--attributes-sinh-từ-vss), [05 §3.3](../../../../../analysis/05-blocks-and-execution-model.md#33-dữ-liệu-dataflow), ADR-0010 §6, ADR-0018 §2.

- **Loại:** bước (category `sensors`); handle vào `target`, ra `source` (thành công) và `error`.
- **Opcode:** `vehicle.read` (args `signal`, `fresh`).
- **`path`:** `sensor` hoặc `actuator` (đọc giá trị hiện tại của actuator là hợp lệ). Path mảng cho output `value` kiểu `T[]` (chỉ đọc; dùng block `sv_array_*` để lấy phần tử).
- **`source`:**
  - `latest-from-trigger` (mặc định) ⇒ `fresh = false`: lấy giá trị mới nhất runtime đã biết (cache từ subscription), không yield. Compiler tự thêm subscription cache-only nếu path chưa được subscribe.
  - `fresh-read` ⇒ `fresh = true`: gọi databroker, là **yield point**; timeout mặc định 2000 ms ⇒ handle `error`.
- **Outputs:** `value` (kiểu/đơn vị signal), `timestamp` (ms, thời điểm giá trị được databroker ghi nhận).
- **Lỗi:** chưa có giá trị (signal chưa từng được publish), timeout, NOT_FOUND/ACCESS_DENIED ⇒ handle `error`; không nối nhánh lỗi ⇒ log + tiếp tục (05 §3.6).
- **Side-effect:** không.

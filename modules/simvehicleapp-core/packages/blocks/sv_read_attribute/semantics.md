# `sv_read_attribute` v1 — ⟨attribute⟩

Nguồn: [05 §2.2](../../../../../analysis/05-blocks-and-execution-model.md#22-sensors--attributes-sinh-từ-vss), ADR-0010 §6.

- **Loại:** bước (category `attributes`); handle vào `target`, ra `source` và `error`.
- **Opcode:** `vehicle.read_attribute` (arg `signal`).
- **`path`:** chỉ `attribute` (giá trị tĩnh của xe, ví dụ `Vehicle.VehicleIdentification.VIN`, `Vehicle.Cabin.DoorCount`).
- **Ngữ nghĩa:** runtime đọc attribute **một lần khi app khởi động** và cache; block trả giá trị cache, không yield.
- **Outputs:** `value` (kiểu/đơn vị attribute; mảng ⇒ `T[]`, ví dụ `Vehicle.Cabin.SeatPosCount` uint8[]).
- **Lỗi:** attribute không có giá trị trên databroker (không có `default` và chưa được provider ghi) ⇒ handle `error`.
  *Lệch so với bảng opcode [06 §2.2](../../../../../analysis/06-ir-and-compiler.md#22-bảng-opcode-v1-đầy-đủ) (chỉ ghi output `value`):* thêm handle `error` vì canvas Sim luôn vẽ handle `error` cho block không phải trigger và vì trường hợp "chưa có giá trị" là có thật — ghi ở Notes ADR-0011.
- **Side-effect:** không.

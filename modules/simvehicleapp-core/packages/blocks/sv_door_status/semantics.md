# `sv_door_status` v1 — Door status

Nguồn: [ADR-0045](../../../../../analysis/adr/ADR-0045-curated-multi-vss-blocks.md), [05 §2.2](../../../../../analysis/05-blocks-and-execution-model.md#22-sensors--attributes-sinh-từ-vss) (Read signal).

- **Loại:** bước composite (category `composite`, P2); handle vào `target`, ra `source` và `error`.
- **Opcode:** `vehicle.read` — một node `vehicle.read` cho mỗi member, `{door}` thay bằng prop `door`:

  | Output | VSS path (v4.0 = v4.2) | Kiểu |
  |---|---|---|
  | `isOpen` | `Vehicle.Cabin.Door.{door}.IsOpen` | boolean (actuator) |
  | `isLocked` | `Vehicle.Cabin.Door.{door}.IsLocked` | boolean (actuator) |
  | `isChildLockActive` | `Vehicle.Cabin.Door.{door}.IsChildLockActive` | boolean (sensor) |

- **`door`:** `Row1.DriverSide` (mặc định), `Row1.PassengerSide`, `Row2.DriverSide`, `Row2.PassengerSide`. Path không có
  trong release ⇒ `VEHICLE_PATH_NOT_FOUND` trên field `door`.
- **`source`:** như Read signal, áp cho mọi member (đọc giá trị hiện tại của actuator là hợp lệ).
- **Lỗi:** như Battery status — member đầu tiên lỗi ⇒ `error`; không nối ⇒ log + member tiếp theo.
- **Side-effect:** không (chỉ đọc; khoá/mở cửa dùng Set actuator).

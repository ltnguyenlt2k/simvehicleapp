# `sv_battery_status` v1 — Battery status

Nguồn: [ADR-0045](../../../../../analysis/adr/ADR-0045-curated-multi-vss-blocks.md), [05 §2.2](../../../../../analysis/05-blocks-and-execution-model.md#22-sensors--attributes-sinh-từ-vss) (Read signal).

- **Loại:** bước composite (category `composite`, P2); handle vào `target`, ra `source` (mọi member đọc được) và `error`.
- **Opcode:** `vehicle.read` — compiler desugar thành một node `vehicle.read` cho mỗi member, theo thứ tự:

  | Output | VSS path (v4.0 = v4.2) | Kiểu |
  |---|---|---|
  | `soc` | `Vehicle.Powertrain.TractionBattery.StateOfCharge.Current` | float, percent |
  | `voltage` | `Vehicle.Powertrain.TractionBattery.CurrentVoltage` | float, V |
  | `current` | `Vehicle.Powertrain.TractionBattery.CurrentCurrent` | float, A |
  | `isCharging` | `Vehicle.Powertrain.TractionBattery.Charging.IsCharging` | boolean |

- **`source`:** như Read signal, áp cho mọi member — `latest-from-trigger` (cache, không yield: bốn giá trị là một ảnh chụp
  trong cùng strand) hoặc `fresh-read` (mỗi member là một yield point, timeout ⇒ `error`).
- **Lỗi:** member đầu tiên chưa có giá trị / timeout / NOT_FOUND ⇒ handle `error` (các member sau không đọc). Không nối
  `error` ⇒ log + đọc member tiếp theo; ref tới output của member lỗi sau đó báo lỗi `no_value` như Read signal.
- **Catalog:** path member không có trong release của workflow ⇒ `VEHICLE_PATH_NOT_FOUND` (không có field).
- **Side-effect:** không.

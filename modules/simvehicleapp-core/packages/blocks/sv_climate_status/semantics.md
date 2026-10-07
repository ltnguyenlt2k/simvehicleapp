# `sv_climate_status` v1 — Climate status

Nguồn: [ADR-0045](../../../../../analysis/adr/ADR-0045-curated-multi-vss-blocks.md), [05 §2.2](../../../../../analysis/05-blocks-and-execution-model.md#22-sensors--attributes-sinh-từ-vss) (Read signal).

- **Loại:** bước composite (category `composite`, P2); handle vào `target`, ra `source` và `error`.
- **Opcode:** `vehicle.read` — một node `vehicle.read` cho mỗi member, `{station}` thay bằng prop `station`:

  | Output | VSS path (v4.0 = v4.2) | Kiểu |
  |---|---|---|
  | `cabinTemperature` | `Vehicle.Cabin.HVAC.AmbientAirTemperature` | float, celsius |
  | `outsideTemperature` | `Vehicle.Exterior.AirTemperature` | float, celsius |
  | `setTemperature` | `Vehicle.Cabin.HVAC.Station.{station}.Temperature` | int8, celsius (actuator) |
  | `fanSpeed` | `Vehicle.Cabin.HVAC.Station.{station}.FanSpeed` | uint8, percent (actuator) |
  | `isAirConditioningActive` | `Vehicle.Cabin.HVAC.IsAirConditioningActive` | boolean (actuator) |

- **`station`:** `Row1.Driver` (mặc định) hoặc `Row1.Passenger`. Path không có trong release ⇒ `VEHICLE_PATH_NOT_FOUND`
  trên field `station`.
- **`source`:** như Read signal, áp cho mọi member.
- **Lỗi:** như Battery status — member đầu tiên lỗi ⇒ `error`; không nối ⇒ log + member tiếp theo.
- **Side-effect:** không.

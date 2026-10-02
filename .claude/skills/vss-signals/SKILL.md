---
name: vss-signals
description: Use when working with COVESA VSS signals — parsing VSS JSON, sensor/actuator/attribute rules, datatypes, units, allowed enums, choosing real signal paths for examples/tests, or the vss-catalog service API.
---

# VSS signals trong SimVehicleApp

Tham chiếu: ADR-0010, ADR-0015, ADR-0018 (mảng & datatype đầy đủ), `analysis/00-research-findings.md` §3.9.

## Sự thật đã verify (VSS 4.0 — mặc định của template Velocitas)
- File: `https://github.com/COVESA/vehicle_signal_specification/releases/download/v4.0/vss_rel_4.0.json`; gốc `{"Vehicle": {"type":"branch","children":{…}}}`.
- Leaf: `datatype`, `type` ∈ sensor|actuator|attribute, `unit`, `min`, `max`, `allowed`, `description`, `uuid`, `deprecation`.
- Đếm: branch 287, actuator 425, sensor 379, attribute 106.
- Datatypes gặp: boolean, double, float, int8, int16, int32, string, string[], uint8, uint16, uint32, uint8[].
- Instance đã expand: `Vehicle.Cabin.Seat.Row1.DriverSide.Position` (tên member C++ model giống hệt).
- v4.0 không kèm `units.yaml` (seed từ nhánh `release/4.0`); v4.2+ có `units.yaml`, `quantities.yaml`.

## Path thật hay dùng (đừng bịa path)
| Path | Kind | Type | Unit/allowed |
|---|---|---|---|
| Vehicle.Speed | sensor | float | km/h |
| Vehicle.IsMoving | sensor | boolean | |
| Vehicle.Powertrain.TractionBattery.StateOfCharge.Current | sensor | float | percent 0–100 |
| Vehicle.Body.Raindetection.Intensity | sensor | uint8 | percent |
| Vehicle.Exterior.AirTemperature | sensor | float | celsius |
| Vehicle.Body.Lights.Hazard.IsSignaling | actuator | boolean | |
| Vehicle.Body.Lights.Beam.Low.IsOn | actuator | boolean | |
| Vehicle.Body.Windshield.Front.Wiping.Mode | actuator | string | OFF, SLOW, MEDIUM, FAST, INTERVAL, RAIN_SENSOR |
| Vehicle.Cabin.Door.Row1.DriverSide.IsLocked | actuator | boolean | |
| Vehicle.Cabin.Door.Row1.DriverSide.Window.Position | actuator | uint8 | percent 0–100 |
| Vehicle.Cabin.Seat.Row1.DriverSide.Position | actuator | uint16 | mm |
| Vehicle.Cabin.Light.InteractiveLightBar.Color | actuator | string | |
| Vehicle.Cabin.HVAC.Station.Row1.Driver.FanSpeed | actuator | uint8 | percent |
| Vehicle.ADAS.CruiseControl.SpeedSet | actuator | float | km/h |
Không có "HMI.IsWarning" actuator trong v4.0 — cảnh báo HMI dùng MQTT (`sv_hmi_notify`) hoặc Hazard/LightBar.

## Quy tắc block
sensor → Read + When changes; actuator → Read + When changes + Set; attribute → Read attribute; branch → chỉ nhóm cây. Ghi vào sensor ⇒ `VEHICLE_WRITE_READ_ONLY`.

## Datatype đầy đủ (12 kiểu vô hướng + dạng mảng `T[]`) — ADR-0018
`boolean, int8, int16, int32, int64, uint8, uint16, uint32, uint64, float, double, string` + `<kiểu>[]`. Đã verify: **0 actuator nào kiểu mảng** trong VSS 4.0/4.2 thật — mảng (`string[]`, `uint8[]`, `float[]`) chỉ xuất hiện ở sensor/attribute (vd `Vehicle.OBD.PidsA` string[] có `allowed`, `Vehicle.Cabin.SeatPosCount` uint8[]) ⇒ UI **không cần** editor ghi mảng, chỉ cần đọc + `len`/`at`/`contains` (block `sv_array_length/at/contains`). `int64`/`uint64` phải mã hoá chuỗi trong mọi JSON (WorkflowGraph/IR/scenario) — JSON number thường mất chính xác khi vượt `Number.MAX_SAFE_INTEGER` (2^53−1).

## Kiểm tra nhanh một path
```bash
python3 -c "import json,sys;d=json.load(open('vss_rel_4.0.json'));n=d['Vehicle'];[n:=n['children'][k] for k in sys.argv[1].split('.')[1:]];print({k:v for k,v in n.items() if k!='children'})" Vehicle.Speed
```

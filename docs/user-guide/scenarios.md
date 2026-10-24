# Kịch bản mẫu: từ cảnh báo đơn giản đến ADAS

Ứng dụng sinh ra từ SimVehicleApp hoạt động như một "hộp đen" đặt giữa các tín hiệu VSS:
1. Đọc tín hiệu (sensor/actuator) từ KUKSA databroker.
2. Xử lý logic theo workflow trên canvas.
3. Ra quyết định: ghi một actuator VSS, hoặc gửi cảnh báo HMI qua MQTT `simvehicleapp/<app>/hmi`.

Bốn kịch bản dưới đây là **conformance case** C42–C45 trong
[`modules/simvehicleapp-contracts/fixtures/conformance/`](../../modules/simvehicleapp-contracts/fixtures/conformance/). Mỗi
case được chạy trên simulator **và** trên code sinh ra cho C++, Python, Rust. CI kiểm hai thứ ở mọi backend:
- chuỗi ghi actuator giống hệt nhau;
- **nội dung cảnh báo HMI giống hệt nhau đến từng ký tự**, kể cả cách in số thực như `72.5` hay `26.666666666666668`.

## Lưu ý về "đạp phanh" trong VSS
VSS chuẩn (4.0/4.2) **không có actuator để ứng dụng tự phanh xe**. Đây là chủ ý vì lý do an toàn:
- `Vehicle.Chassis.Brake.PedalPosition` và `Vehicle.ADAS.EBA.IsEngaged` đều là **sensor** (đọc được, không ghi được).

Các actuator ứng dụng được phép ghi:
- `Vehicle.Body.Lights.Brake.IsActive` — đèn phanh: `INACTIVE` / `ACTIVE` / `ADAPTIVE`;
- `Vehicle.ADAS.CruiseControl.IsActive` và `SpeedSet` — huỷ cruise hoặc giới hạn tốc độ đặt;
- `Vehicle.ADAS.EBA.IsEnabled` — bật/tắt tính năng phanh khẩn cấp;
- `Vehicle.Chassis.ParkingBrake.IsEngaged`.

Nếu xe thật có tín hiệu yêu cầu phanh hay giảm tốc riêng của OEM, hãy thêm nó vào một
[mô hình VSS tuỳ biến](custom-vss.md) rồi dùng block `Set actuator` như mọi tín hiệu khác.

## C42 — Quá tốc độ 60 km/h (cơ bản)
| Khi | Thì |
|---|---|
| `On condition` `<Vehicle.Speed> > 60` (cạnh false→true) | HMI `warning` "Speed <Vehicle.Speed> km/h > 60" → đèn phanh `"ACTIVE"` → `CruiseControl.SpeedSet = 60` |
| `On condition` `<Vehicle.Speed> <= 55` | đèn phanh `"INACTIVE"` → HMI `info` "Speed OK" |

Hai ngưỡng 60/55 tạo **trễ (hysteresis)**: tốc độ dao động quanh 57–59 không làm cảnh báo bật tắt liên tục. Điều kiện
chỉ kích hoạt khi chuyển từ false sang true, nên tốc độ tăng tiếp từ 72,5 lên 80 không cảnh báo lặp lại.

## C43 — Cảnh báo va chạm phía trước (ADAS)
`On condition` `<Vehicle.ADAS.ObstacleDetection.IsWarning> && <Vehicle.Speed> > 30` → `If` `<Vehicle.Chassis.Brake.PedalPosition> < 10`:
- **Tài xế chưa phanh:** HMI `critical` "Brake now: … km/h", đèn phanh `"ACTIVE"`, huỷ cruise (`IsActive = false`).
- **Tài xế đang phanh:** chỉ HMI `info` "Pedal … %".

Khi cảnh báo vật cản hết (`!<…IsWarning>`), đèn phanh trở về `"INACTIVE"`. Dưới 30 km/h kịch bản không làm gì.

## C44 — Mất tập trung / lệch làn, leo thang (ADAS)
- `On condition` (lệch làn **hoặc** buồn ngủ DMS) **và** tốc độ > 60 → `Stable for 1 s`: cảnh báo chớp nhoáng
  (300 ms) không được tính.
- Mỗi lần giữ đủ 1 giây: tăng biến `warnings` (int32) → HMI "Warning n of 3".
- Lần thứ 3: HMI `critical`, bật đèn khẩn cấp (`Hazard.IsSignaling = true`), huỷ cruise.

## C45 — Đường trơn, giới hạn tốc độ (ADAS + lọc nhiễu)
- `On signal changed` `Vehicle.ADAS.ESC.RoadFriction.MostProbable` → `Filter` trung bình trượt 3 mẫu (lọc nhiễu cảm biến).
- `If` trung bình < 30 % và tốc độ > 50 → `CruiseControl.SpeedSet = clamp(<Vehicle.Speed> - 20, 30, 50)` → HMI
  "Friction … %".

## Tự dựng và kiểm tra
1. Studio: tạo workflow như bảng trên, chọn tín hiệu trong bảng Signals.
2. **Simulate** với cùng chuỗi input: timeline phải khớp file `scenario.yaml` của case.
3. **SynCode** sinh code. Test sinh ra cho project dùng cùng scenario và kiểm cả writes lẫn nội dung HMI (`expect.publishes`).
4. **Run** trên databroker, inject tín hiệu ở bảng Signals, xem actuator và log HMI.

Với giá trị enum chuỗi trong biểu thức (ví dụ `"ACTIVE"`), cần để trong dấu ngoặc kép. Ô nhập giá trị của block
`Set actuator` có gợi ý nhanh (quick pick) các giá trị hợp lệ cho actuator boolean hoặc có danh sách `allowed`.

## Nhờ trợ lý soạn test case
Trong panel trợ lý, gõ ví dụ "test this workflow" hoặc "test speed above 120":
1. Trợ lý đọc workflow và các test case đang có, đề xuất vài case (giá trị biên, nhánh then/else).
2. Mỗi case được kiểm schema và chạy Simulate trước khi hiện; câu trả lời ghi case nào workflow đạt, case nào không.
3. Thẻ **Proposed test cases** liệt kê các case. **Add to Test tab** lưu chúng thành case mới và mở tab Test với case đầu tiên. **Reject** bỏ đi; chưa có gì được lưu trước khi bạn bấm.

Với `SV_AI_PROVIDER=fake` (offline), trợ lý chỉ hiểu câu có "test" + "speed" + một con số, và đề xuất hai case: ngay qua ngưỡng và đúng ngưỡng.

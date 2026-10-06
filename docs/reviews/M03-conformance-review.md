# Review conformance C01–C38 (gate M3)

> **Trạng thái:** review do agent thực hiện theo **uỷ quyền của PO ngày 2026-10-06** ("thực hiện tuần tự cho đến hết không cần hỏi lại"). **Chờ PO xác nhận** khi verify cuối. Đây không phải chữ ký PO.

- Phạm vi: `modules/simvehicleapp-contracts/fixtures/conformance/C01…C38/{graph.json, scenario.yaml}`, đối chiếu ADR-0012 (§1–§10 + Notes M03-T09/T12) và BlockSpec trong `packages/blocks`.
- Cách làm: suy tay lại từng mốc thời gian ảo của `expect.writes`/`expect.trace` từ graph + inputs, độc lập với kỳ vọng đã ghi; kiểm chéo giữa các ca có cùng quy tắc.
- Kết quả: **37/38 đúng; 1 lỗi đã sửa (C08)**. `bun test` contracts 315/315 PASS sau khi sửa.

## Lỗi tìm thấy

| Ca | Vấn đề | Sửa |
|---|---|---|
| C08 | `initial` Speed = 50, input t=2000 cũng là 50 với `mode: any`, nhưng kỳ vọng có lệnh ghi lúc 2000. Mâu thuẫn C01 (giá trị bằng nhau không bắn). Một runtime đúng sẽ fail ca này. | Input t=2000 đổi thành **60**. Ca vẫn kiểm đúng ý "giá trị lúc khởi động là mốc": không có ghi ở t=0; có thay đổi thật thì bắn ở 2000. |

## Bảng review

| Ca | Quy tắc | Suy tay | KQ |
|---|---|---|---|
| C01 | any: bắn mỗi thay đổi | 0→10 bắn, 10→10 không, 10→20 bắn | ✔ |
| C02 | rising | 0→10 ✓, 10→5 ✗, 5→7 ✓ | ✔ |
| C03 | falling | chỉ 10→5 | ✔ |
| C04 | crosses_above 100: prev ≤ 100 < v | 90→110 ✓ (2000), 95→101 ✓ (5000) | ✔ |
| C05 | crosses_below 100: prev ≥ 100 > v | 110→90 ✓, 105→100 ✗ (chạm ngưỡng), 100→99 ✓ | ✔ |
| C06 | becomes true | false→true 1000 ✓, true→true ✗, →false ✗, →true 4000 ✓ | ✔ |
| C07 | debounce 500 sau thay đổi cuối | burst kết thúc 1400 → 1900; 3000 → 3500 | ✔ |
| C08 | mốc khởi động | xem mục lỗi | ✔ (đã sửa) |
| C09 | restart | run 1000 bị huỷ lúc 1500; run mới + wait 1000 → 2500, value 20 | ✔ |
| C10 | ignore | 1000→2000 (10); 1500 bỏ; 2500→3500 (30) | ✔ |
| C11 | queue tuần tự, giữ giá trị riêng | 2000/3000/4000 = 10/20/30 | ✔ |
| C12 | queueMax 8, tràn bỏ cũ nhất | 9 sự kiện chờ ⇒ bỏ "2"; ghi 1,3…10; trace `queue_overflow` | ✔ |
| C13 | parallel chồng nhau | 2000/2100/2200 | ✔ |
| C14 | maxRuns 4 bỏ sự kiện mới | sự kiện thứ 5 bị bỏ | ✔ |
| C15 | timer: tick đầu tại initialDelay, tick đếm từ 1 | 500/1500/2500 = 1/2/3 | ✔ |
| C16 | timer bận ⇒ bỏ tick, không bù | tick1 1000 + wait 1500 → 2500; tick2 bỏ; tick3 3000 → 4500; tick4 bỏ | ✔ |
| C17 | app start một lần ở t=0 | ghi t=0; đổi Speed không bắn lại | ✔ |
| C18 | wait là điểm nhường | 0 và 500 | ✔ |
| C19 | wait 0 giữ thời gian + thứ tự | hai ghi cùng t=0, đúng thứ tự | ✔ |
| C20 | if/else | 50 → else (false), 150 → then (true) | ✔ |
| C21 | switch: case đầu khớp, else default | 10→1, 20→2, 30→default 0 | ✔ |
| C22 | stable_for 2000 | 1000 + 2000 → 3000 | ✔ |
| C23 | stable_for broken ngay khi điều kiện sai | Speed 50 lúc 2000 → broken (false) | ✔ |
| C24 | wait_until ok | điều kiện đúng lúc 2000 | ✔ |
| C25 | wait_until timeout | 2000 + 3000 → 5000 timeout (false) | ✔ |
| C26 | wait_until đã đúng sẵn | đi tiếp ngay t=0 | ✔ |
| C27 | repeat count 3, `<loop.index>` 0…2 | 0,1,2 rồi Hazard | ✔ |
| C28 | intervalMs giữa các vòng, không sau vòng cuối | 0/1000/2000, Hazard 2000 | ✔ |
| C29 | vượt maxIterations dừng run | 3 ghi, trace `loop_guard`, không ghi Hazard | ✔ |
| C30 | while kiểm điều kiện trước mỗi vòng | ghi cuối 3 | ✔ |
| C31 | join all | nhánh 1000/2000, Hazard 2000 | ✔ |
| C32 | join any huỷ nhánh còn lại | 1000 nhánh nhanh + Hazard; Wiper không ghi | ✔ |
| C33 | join none đi tiếp ngay | Hazard t=0; nhánh 1000/2000 vẫn chạy | ✔ |
| C34 | stop(workflow) huỷ mọi run đang chờ | run 1000/1200 (đến 2000/2200) bị huỷ lúc 1500 ⇒ không ghi | ✔ |
| C35 | biến dùng chung toàn app | n = 1 rồi 2 | ✔ |
| C36 | cùng một sự kiện: theo thứ tự trigger | b1 (1) trước b3 (2), cùng t=1000 | ✔ |
| C37 | trigger MQTT mặc định queue | 1500 SLOW, 2000 FAST | ✔ |
| C38 | condition chỉ bắn ở cạnh false→true | 150 ✓, 160 ✗, 50 (về false), 120 ✓ | ✔ |

## Ghi chú cho M5 (simulator)
- `expect.writes` được hiểu là **danh sách đầy đủ và đúng thứ tự** (C34 `writes: []` nghĩa là không có ghi nào). Bộ chạy conformance M5 phải so khớp chặt, không chỉ kiểm "có chứa".
- `expect.trace` là matcher con (chỉ cần chứa các sự kiện đã liệt kê).

## Cập nhật 2026-10-06 (M04-T08, compiler có kiểu)
Compiler M4 (kiểu + unit, ADR-0015 Notes §7) từ chối 14 graph conformance được viết ở M3 khi chưa kiểm kiểu — lỗi thật của fixture, không phải của compiler:
- C09–C14, C34, C35 ghi giá trị trigger `Vehicle.Speed` (float, km/h) vào `FanSpeed` (uint8, %): khác dimension. Trigger đổi sang `Vehicle.Body.Raindetection.Intensity` (uint8, %), giá trị input giữ nguyên.
- C15/C16 ghi `<tick.tick>` (uint32), C30/C35 ghi biến `int32` vào `uint8`: thu hẹp. Bọc `min(…, 100)` / `clamp(…, 0, 100)` (miền [0, 100] gán thẳng được).
- C27–C29 (`<loop.index>`) hợp lệ không cần sửa: compiler suy miền chỉ số từ `count`/`maxIterations` của container.

Mọi kỳ vọng ghi (`expect.writes`) giữ nguyên; suy tay lại không đổi.

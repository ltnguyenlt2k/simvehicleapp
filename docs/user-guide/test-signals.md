# Kiểm logic workflow bằng tín hiệu

Có ba cách kiểm, từ nhanh tới sát xe thật:
- **Simulate:** không cần build, chạy trên đồng hồ ảo trong bộ nhớ.
- **Run + tab Live:** app thật chạy trên KUKSA databroker, bạn bắn tín hiệu từ UI.
- **Bắn tín hiệu từ ngoài:** curl hoặc kuksa-client.

Đã kiểm thực tế trên stack dev:
- 2026-10-15: các lệnh kuksa-client và curl, trên workflow cảnh báo vượt tốc GW-A;
- 2026-10-24: tab Test và tab Live qua E2E full luồng `@live` và `m18-test-cases`; Play kịch bản ADAS C43/C44 trên app C++, Python, Rust thật (`gate/adas-live.sh`).

Bảng các bước LKA ở mục 2 được suy ra từ logic đã build của workflow LKA, chưa chạy thử từng bước.

## 1. Tab Test: test case + Simulate (không cần build)
Dock dưới có ba tab **Problems · Test · Live**. Tab **Test** chứa các *test case* của workflow:
- Workflow chưa có case: bấm **Generate tests**. Studio sinh case từ chính workflow: giá trị biên của mỗi phép so sánh, *Stable for* giữ đủ và bị ngắt. Kỳ vọng được chốt từ simulator. Dòng **Branches covered: x / y** cho biết các case đã đi qua bao nhiêu nhánh.
- Mỗi case có **Given** (giá trị ban đầu), **When** (input theo thời gian) và **Then** (write mong đợi, kèm sai số *within* ms, và các tín hiệu *never* bị ghi). Chế độ **YAML** cho phép dán scenario.
- **Simulate** chạy case đang chọn; **Simulate all** chạy mọi case. Mỗi case hiện ✓ hoặc ✕; rê chuột lên ✕ để xem lý do.
- Có thể **Ask the assistant** để trợ lý đề xuất case (xem [scenarios](scenarios.md#nhờ-trợ-lý-soạn-test-case)).

Ví dụ YAML cho workflow cảnh báo chệch làn (LKA):

```yaml
scenarioVersion: 1.0.0
name: LKA
until: 6000
initial:
  Vehicle.Speed: 0
  Vehicle.ADAS.LaneDepartureDetection.IsWarning: false
  Vehicle.ADAS.LaneDepartureDetection.IsEnabled: false
inputs:
  - { t: 1000, path: Vehicle.Speed, value: 5 }
  - { t: 1500, path: Vehicle.ADAS.LaneDepartureDetection.IsWarning, value: true }   # tốc độ ≤ 10 ⇒ nhánh else (log)
  - { t: 2500, path: Vehicle.ADAS.LaneDepartureDetection.IsWarning, value: false }
  - { t: 3000, path: Vehicle.Speed, value: 60 }
  - { t: 3500, path: Vehicle.ADAS.LaneDepartureDetection.IsWarning, value: true }   # tốc độ > 10 ⇒ HMI + IsEnabled = true
```

Timeline dưới case liệt kê từng lần ghi tín hiệu, từng thông báo HMI và log. Kéo thanh tua để xem block nào chạy lúc nào. **Mỗi test case trở thành một test của app khi SynCode** (C++, Python, Rust).

## 2. Run + tab Live (app thật trên databroker)
1. Workflow phải nằm trong một vehicle app. Bấm **SynCode** sau mỗi lần sửa workflow: **Run chạy bản build gần nhất**, không phải canvas hiện tại.
2. Bấm **Run**, đợi pill hiện `Running`.
3. Mở tab **Live**. Bảng Signals tự liệt kê mọi tín hiệu workflow đọc, kể cả tín hiệu chỉ có trong **biểu thức** (vd. `<Vehicle.Speed>` trong điều kiện If).
   - Thêm tín hiệu khác: gõ vài chữ ("speed", "tốc độ") vào ô **Watch a signal** rồi chọn gợi ý, hoặc kéo một tín hiệu từ panel Vehicle thả vào bảng. Danh sách thêm tay được nhớ theo workflow.
   - Mỗi dòng gợi ý thay đổi nào sẽ kích hoạt trigger (ví dụ "rises: false → true").
4. Inject: ô nhập theo kiểu của tín hiệu (công tắc cho boolean, danh sách cho enum, số kèm đơn vị và khoảng hợp lệ). Sensor nhận một giá trị; actuator chọn `request (target)` hoặc `simulate feedback (current)`. Bấm **Inject**.
   - **App ghi actuator thế nào** (từ 2026-10-17, [ADR-0047](../../analysis/adr/ADR-0047-kuksa-val-v2-migration.md)):
     - app dùng `kuksa.val.v2` (mặc định) và gửi *Actuate*;
     - signal-gateway đóng vai provider, publish giá trị đó thành **giá trị hiện tại**;
     - nên trên bảng Signals, cột hiện tại đổi, còn `target` có thể trống.
   - Stack đặt `SV_DATABROKER_API=*=sdv.databroker.v1` thì app ghi `target` như trước (gateway mirror sang hiện tại).
5. Xem kết quả:
   - **Signals:** cột *Target* của actuator là giá trị app vừa ghi; *Current* theo sau (stack giả lập xe thực hiện lệnh).
   - **Run console** (pane đầu của tab Live): log của app và trace từng block đã chạy.
   - **Messages** (pane thứ hai): thông báo HMI hiện thành thẻ; các tin MQTT khác của app hiện kèm topic.
   - Badge trên block cho biết block nào vừa chạy.

**Ví dụ LKA** ("Lane departure warning" → If `Vehicle.Speed > 10` → *then* HMI "LKA: chệch làn" → Set `IsEnabled = true`; *else* log):

| Bước | Inject | Kết quả mong đợi |
|---|---|---|
| 0 | `IsEnabled` = `false` (value) | Đặt trạng thái ban đầu để thấy thay đổi |
| 1 | `Vehicle.Speed` = `5` (value) | Không có gì (chưa có trigger) |
| 2 | `IsWarning` = `false`, rồi `true` (value) | Trigger *rises* (false → true). Tốc độ ≤ 10 ⇒ nhánh **else**: Run console có log "LKA không kích hoạt"; `IsEnabled` không đổi |
| 3 | `Vehicle.Speed` = `60` | Không có gì (tốc độ không phải trigger) |
| 4 | `IsWarning` = `false`, rồi `true` | Nhánh **then**: Run console có trace "LKA warning" (HMI) và "Enable LDD"; `IsEnabled` = `true` (giá trị hiện tại, xem ghi chú dưới) |

Lưu ý:
- Trigger kiểu **"Value rises"** chỉ chạy khi giá trị **đổi từ false sang true**. Inject `true` hai lần liền thì lần hai không kích hoạt; phải về `false` trước.
- Một biểu thức đọc tín hiệu chưa từng có giá trị (vd. `Vehicle.Speed` chưa được inject) không cho kết quả như mong đợi. Luôn đặt giá trị trước.
- **Record** trong tab Live ghi các lần inject; **Save as test case** lưu thành case mới ở tab Test, kỳ vọng được đề xuất từ những gì app đã ghi (within 300 ms).
- **Play on vehicle** (tab Test, khi app đang Run) phát case đang chọn lên databroker thật và chấm điểm theo những gì app thật ghi (sai số 300 ms). Playback kéo dài đến hết `until` của case, nên write của app sau input cuối cũng được tính.

## 3. Bắn tín hiệu từ ngoài (curl, kuksa-client)
Khi app đang Run, tín hiệu đi qua **gRPC tới KUKSA Databroker** (cổng `127.0.0.1:55555` trên máy chạy stack, release v4.0).

**kuksa-client (CLI chính thức của Eclipse KUKSA):**
```bash
docker run --rm -it --network host python:3.12-slim bash -c \
  "pip install -q kuksa-client && kuksa-client grpc://127.0.0.1:55555"
# trong shell kuksa-client:
setValue Vehicle.Speed 60
setValue Vehicle.ADAS.LaneDepartureDetection.IsWarning false
setValue Vehicle.ADAS.LaneDepartureDetection.IsWarning true
getTargetValue Vehicle.ADAS.LaneDepartureDetection.IsEnabled
subscribe Vehicle.ADAS.LaneDepartureDetection.IsEnabled
```

**curl qua signal-gateway** (chỉ có trong mạng Docker nội bộ):
```bash
S=$(sed -n 's/^INTERNAL_API_SECRET=//p' .env); NET=simvehicleapp_sv-internal
# xem realtime
docker run --rm -it --network $NET curlimages/curl -sN -H "x-sv-internal: $S" \
  "http://signal-gateway:4050/signals?release=v4.0&paths=Vehicle.Speed,Vehicle.ADAS.LaneDepartureDetection.IsEnabled"
# bắn tín hiệu
docker run --rm --network $NET curlimages/curl -s -X POST -H "x-sv-internal: $S" -H 'content-type: application/json' \
  -d '{"release":"v4.0","path":"Vehicle.Speed","value":60,"field":"value"}' http://signal-gateway:4050/signals
```

**Một hay nhiều app cùng lúc** ([ADR-0057](../../analysis/adr/ADR-0057-shared-vehicle-runtime-run-slot.md)):

- **`SV_RUN_SANDBOX=0` (stack dùng chung):**
  - Cả máy chỉ một app được Run tại một thời điểm. App khác đang chạy thì Run báo "Another project is running".
  - Mỗi release dùng chung một databroker, nên tín hiệu bắn từ ngoài (các lệnh trên) tác động lên app đang Run.
- **`SV_RUN_SANDBOX=1`:**
  - Mỗi run có databroker riêng. Bảng Signals, inject và Play của app đi vào databroker đó.
  - Bạn chạy được nhiều app (theo quota). Run khi đang chạy app khác sẽ hỏi *Stop … and run* hoặc *Run both*.
  - Run tự dừng sau `SV_RUN_MAX_MINUTES`. Khi còn 5 phút, bấm **Extend** để chạy thêm. Menu **My runs** liệt kê các app bạn đang chạy.
  - Lệnh `curl`/`kuksa-client` từ host vào `127.0.0.1:55555` **không** tới run có sandbox, vì cổng sandbox không mở ra host.
  - Muốn bắn từ ngoài: lấy `sandbox` của run (`scripts/sv runs list`), rồi gọi signal-gateway trong mạng `sv-internal`:
    ```bash
    docker run --rm --network $NET curlimages/curl -s -X POST -H "x-sv-internal: $S" -H 'content-type: application/json' \
      -d '{"release":"v4.0","sandbox":"toolchain-cpp:56000","path":"Vehicle.Speed","value":60,"field":"value"}' http://signal-gateway:4050/signals
    ```

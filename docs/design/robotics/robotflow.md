# RobotFlow — compiler, IR, codegen Python, runtime `rfrt`

> Quyết định: [ADR-0067](../../../analysis/adr/ADR-0067-robotflow-compiler-and-python-runtime.md). Trạng thái: **thiết kế**, chưa có code.

## 1. Chọn ngôn ngữ ("ngôn ngữ nào dễ trước")

| Lựa chọn | Đánh giá | Kết luận |
|---|---|---|
| **Python 3.12** cho compiler, runtime và app sinh ra | Dễ đọc với người dùng; cùng hệ sinh thái ROS 2 (rclpy) và bridge; asyncio đủ cho workflow sự kiện; không cần toolchain biên dịch | **Chọn cho v0.1** |
| C++ (như Velocitas C++) | Hiệu năng cao nhất | Toolchain nặng (build image, compile vài phút), khó cho máy yếu ⇒ backlog |
| Rust | An toàn bộ nhớ | Toolchain nặng, ít người dùng phổ thông đọc được ⇒ backlog |
| TypeScript trong trình duyệt | Lint tức thì | Vi phạm "không thông dịch hành vi robot trong browser"; tách khỏi runtime ⇒ loại |

Compiler viết bằng Python để có **một** toolchain cho mọi thành phần robotics. App sinh ra chạy trên runtime `rfrt` (wheel cài sẵn trong image runner). App không gọi ROS, chỉ gọi Protobus.

## 2. Định dạng workflow `robotflow.v1`

```json
{
  "schema": "robotflow.v1",
  "rss": { "version": "0.1", "catalogHash": "sha256:…" },
  "profile": "dog-go2-sim",
  "source": { "workflowId": "<id studio>", "name": "Chào khi thấy marker" },
  "vars": { "greeted": { "type": "bool", "initial": false } },
  "nodes": [
    { "id": "n1", "block": "rf.on_start", "v": 1, "props": {} },
    { "id": "n2", "block": "rf.arm", "v": 1, "props": {} },
    { "id": "n3", "block": "rf.wait_until", "v": 1, "props": { "when": "Robot.Perception.Marker.IsDetected == true", "timeoutMs": 60000 } },
    { "id": "n4", "block": "rf.perform", "v": 1, "props": { "name": "WAVE_FRONT_LEFT", "timeoutMs": 15000 } }
  ],
  "edges": [ { "from": ["n1", "next"], "to": ["n2", "in"] } ]
}
```

- Mã định danh node lấy **nguyên** id block của studio: trace và diagnostics trỏ đúng block trên canvas.
- Không có vị trí UI trong `robotflow.v1`: vị trí là việc của studio. Hash nguồn chỉ phụ thuộc ngữ nghĩa.

## 3. Block v0.1 (registry `block.v1`, nguồn duy nhất cho compiler + palette)

| Nhóm | Block (studio type ⇄ RobotFlow id) | Cổng ra |
|---|---|---|
| Trigger | `rf_on_start` ⇄ `rf.on_start`; `rf_on_change` (path); `rf_on_condition` (biểu thức + giữ `forMs`); `rf_every` (chu kỳ ≥ 100 ms); `rf_on_event` (sự kiện tên từ GUI/Inject) | `next` |
| Luồng | `rf_if`; `rf_switch`; `rf_wait` (ms); `rf_wait_until` (biểu thức, timeout); `rf_loop` (n lần / while); `rf_parallel` + `rf_join`; `rf_end` | `then/else`, `case_*`, `next`, `timeout` |
| Dữ liệu | `rf_read` (path → biến); `rf_assign` (biến = biểu thức); `rf_log` (mức, thông điệp template `{{Robot.Pose.Position.X}}`) | `next` |
| An toàn | `rf_arm`; `rf_disarm`; `rf_stop`; `rf_reset_stop` | `succeeded/failed/rejected` |
| Chuyển động | `rf_move` (LinearX, AngularZ, thời lượng; setpoint 20 Hz; luôn trả về `safeValue` khi thoát); `rf_turn` (góc → quay đến khi đạt yaw); `rf_perform` (tên động tác); `rf_cancel` | `succeeded/failed/rejected/cancelled/timed_out` |
| Điều hướng | `rf_go_to` (X, Y map); `rf_follow_route` (≤ 20 điểm); `rf_patrol` (route lặp n vòng) | như trên |
| Hàm | `rf_call_workflow` + `rf_on_call` (gọi workflow hàm miền Robot, inline lúc compile) | `next` |

**Ngữ nghĩa bắt buộc:**

- **Mọi block điều khiển có đủ cổng kết quả.** Không cổng nào nối ⇒ diagnostic, buộc người dùng xử lý thất bại.
- **`rf_move` không bao giờ Arm ngầm.** Thiếu Arm trước đó ⇒ cảnh báo `RF4010`, và runtime trả `rejected`.
- **Điều kiện dùng dữ liệu `STALE`** ⇒ đi cổng lỗi/timeout, không bao giờ tự chọn nhánh chuyển động.

## 4. Biểu thức và đơn vị

- **Cú pháp:**
  - số có đơn vị (`0.3 m/s`, `20 %`, `500 ms`);
  - path RSS;
  - biến;
  - `+ - * /`, `== != < <= > >=`, `and or not`;
  - hàm đóng: `abs, min, max, clamp, deg, rad`.
- **Kiểm kiểu và đơn vị lúc compile:** `RF2xxx`, ví dụ so sánh `m` với `m/s` là lỗi.
- **Parser tự viết (Pratt):** không `eval`; codegen sinh code Python từ AST đã kiểm.

## 5. Compiler `rflowc`

**Stage:**

1. `parse` (schema `robotflow.v1`).
2. `resolve`: block registry + catalog RSS + profile.
3. `typecheck`: props, biểu thức, đơn vị.
4. `structure`: block treo, chu trình, cổng chưa nối, parallel/join.
5. `safety-lint`: chuyển động không có Arm trước, không xử lý thất bại, setpoint vượt profile.
6. `lower` → IR `rfir.v1`.
7. `codegen` (Python).

**Diagnostics:**

- mã `RF1xxx`–`RF6xxx`, mức `error/warning/info`;
- mỗi diagnostic trỏ `nodeId` + `prop` để GUI tô đúng block;
- catalog công khai: chỉ thêm, không đổi tên.

**Đầu ra build** (file set, compiler không ghi đĩa):

```text
app/__init__.py  app/flow.py  app/main.py
rfir.json  rss-catalog.json  profile.json  registry.json  workflow.json
rflow.lock.json   # sha256 từng file + workflowHash, catalogHash, profileHash, irHash, compilerVersion, runtimeVersion
```

**Tất định:** cùng input ⇒ cùng bytes. Không timestamp, không random, sắp xếp ổn định.

## 6. Runtime `rfrt`

- Một event loop asyncio:
  - mỗi trigger là một *behavior*;
  - chính sách kích hoạt lại `queue/drop/restart` theo prop;
  - `parallel` dùng task group.
- **Client Protobus:**
  - `Subscribe` theo đúng tập path compiler xác định (không subscribe thừa);
  - lease điều khiển lấy khi có block điều khiển đầu tiên, nhả khi xong;
  - làm mới setpoint 20 Hz từ một timer chung.
- **Log và trace có cấu trúc** (JSON lines, một dòng/sự kiện):
  - `run_started`, `node_started`, `node_finished{port, durationMs}`;
  - `signal{path, value, quality}` (chỉ các path workflow dùng, có giới hạn tần số);
  - `log{level, text}`, `run_finished{reason}`.
  - GUI dựng *Flow* (block đang chạy, cổng đã đi) từ trace này, giống mô hình Flow của xe (ADR-0062) nhưng contract riêng `rfevent.v1`.
- **Kiểm tra tính toàn vẹn khi khởi động:**
  - hash file khớp `rflow.lock.json`;
  - runtime version khớp;
  - sai ⇒ không chạy.
- **Giới hạn:** RAM app ≤ 96 MiB, log ≤ 2.000 dòng/phút (vượt thì gộp), một run mỗi robot/mode.

## 7. Kịch bản (scenario) và test

"Workflow kéo thả log có kịch bản" được hiện thực bằng **scenario `scenario.v1`** chạy trên mode `mock`:

```json
{
  "schema": "scenario.v1",
  "name": "Pin yếu thì không chào",
  "timeline": [
    { "atMs": 0,    "set": { "Robot.PowerSystem.Battery.StateOfCharge": 15 } },
    { "atMs": 500,  "set": { "Robot.Perception.Marker.IsDetected": true } }
  ],
  "expect": [
    { "withinMs": 3000, "log": { "contains": "Pin yếu" } },
    { "never": { "command": "Robot.Motion.Perform" } },
    { "withinMs": 5000, "signal": { "Robot.Safety.Mode": "DISARMED" } }
  ],
  "timeoutMs": 10000
}
```

- Nhiều scenario mỗi workflow; GUI tab *Test* hiển thị PASS/FAIL, kèm lý do (mốc kỳ vọng nào trượt, log liên quan).
- Scenario chạy với **thời gian thực** (`timeScale = 1`) trên mock để đúng ngữ nghĩa TTL/watchdog.
- Không chạy scenario trên `ros-sim` (không tiêm giá trị giả vào robot). Kiểm chứng trên ROS là E2E riêng (M28).
- Conformance compiler/runtime: bộ workflow chuẩn RW-A…RW-F (bảng dưới) có golden IR + scenario, chạy hai lần liên tiếp trong CI.

| ID | Workflow chuẩn | Chứng minh |
|---|---|---|
| RW-A | Arm → đi thẳng 2 s → quay 90° → Disarm | setpoint TTL, Arm/Disarm |
| RW-B | Thấy marker → WAVE_FRONT_LEFT → log | trigger điều kiện, command kết quả vật lý |
| RW-C | Pin < 20 % giữ 5 s → về điểm sạc (GoTo) | debounce, điều hướng |
| RW-D | Patrol 3 điểm × 2 vòng, vật cản < 0,5 m ⇒ Stop + log | route, an toàn |
| RW-E | Chuỗi trình diễn: BOW → JUMP → SIT → STAND, xử lý mọi cổng lỗi | động tác nối tiếp |
| RW-F | Workflow hàm "an toàn trước khi chạy" được gọi từ hai workflow | sub-workflow |

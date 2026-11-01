# M24: Protobus ROS 2 bridge + profile dog-go2-sim (chạy thật trên dog sim)

> **ADR:** [0066](../adr/ADR-0066-protobus-signal-broker-and-ros2-bridge.md), [0069](../adr/ADR-0069-robotics-safety-and-execution-policy.md). **Thiết kế:** [protobus.md §4](../../docs/design/robotics/protobus.md).
> **Phụ thuộc:**
> - gate M23 PASS;
> - **dog R4 W1** (kênh `/dog1/workflow/request` + trọng tài quyền + peer DDS) và **W4** (contract topics cập nhật) đã merge và kiểm ở repo dog;
> - W2 (động tác mới) chỉ cần cho T06 phần WAVE/SIT/STAND.

## Mục tiêu
Tín hiệu RSS ↔ ROS 2 đi đúng mapping trên dog sim thật: telemetry khớp, lệnh cấp cao chạy, Stop và các tình huống lỗi về an toàn.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | Schema `mapping.v1` + transform đóng + test | robotics/contracts, protobus | — | Test từng transform |
| T02 | Image bridge (ROS 2 Humble pin digest, rclpy, CycloneDDS config peers) + compose profile `ros` gia nhập network dog | robotics/protobus | T01, dog W1 | Bridge healthy; thấy topic dog |
| T03 | Telemetry: subscription lười, downsample, `captureTime` từ header/`issued_at_ns`, `STALE` | robotics/protobus | T02 | ≥ 30 path so khớp giá trị ROS (sai số theo kiểu) |
| T04 | Envelope schema-1 (`request_id`, `issued_at_ns` từ `/clock`, `config_hash` học từ dog), từ chối khi lệch | robotics/protobus | T02 | Request cũ bị Brain từ chối và được báo `REJECTED` |
| T05 | Safety: Arm/Disarm/Stop/ResetStop qua `workflow/request`; SafetyLane → `stop` + xác nhận `SAFE_STOP` | robotics/protobus | T04 | Stop p95 < 500 ms đo trên ROS |
| T06 | Setpoint `Robot.Motion.Velocity` 20 Hz; command `Perform` (JUMP, LIFT_FRONT_LEFT; WAVE_FRONT_LEFT/SIT/STAND khi dog W2 xong), `GoTo`, `FollowRoute`, `Cancel` với kết quả vật lý | robotics/protobus | T05 | Mỗi lệnh có ca SUCCEEDED và ca REJECTED thật |
| T07 | Fault: giết bridge/broker/app giữa lúc đi ⇒ dog dừng (watchdog 0,2 s); operator STOP ở Robot Zoo thu hồi lease | robotics | T06 | Bằng chứng log + trạng thái Brain |
| T08 | Soak 30 phút: telemetry + lệnh chu kỳ; RAM/CPU trong ngân sách | robotics | T07 | Không rò RAM > 10 %; không khoảng hở setpoint > 150 ms |
| T09 | Gate + báo cáo M24 | docs | T01–T08 | `docs/reports/M24.md` |

## Acceptance Gate
- T03–T08 chạy trên **dog sim thật** (không mock), commit hai repo được pin trong báo cáo.

## Rủi ro
- Dog W1 trễ ⇒ M24 chặn. Không được "tạm" publish vào `control/request` (vi phạm contract một-publisher).

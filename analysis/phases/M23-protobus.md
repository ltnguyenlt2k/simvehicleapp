# M23: Protobus — broker RSS + provider ROS 2 + adapter dog + luật an toàn

> **Yêu cầu:** PO 2026-10-27 — "tạo một protobus độc lập tương tự như kuksa… mapping tín hiệu define tại rss sang ros2 để giao tiếp với robot thông qua ros2".
> **Thiết kế:** [design](../../docs/design/M22-robotics-extension.md) §3, §5, §9.
> **ADR:** [0066](../adr/ADR-0066-protobus-rss-ros2-bridge.md) (Proposed — chờ PO xác nhận).
>
> **Phụ thuộc:**
> - Gate M22 PASS;
> - stack dog chạy được trên máy (`tools/dev start` của repo dog, domain 42);
> - Spike T01–T03 làm được ngay sau M22-T06.
>
> **Nguyên tắc:**
> - KUKSA không fork;
> - provider không bao giờ phát lệnh motor/`cmd_vel`;
> - an toàn được kiểm bằng fault test, không chỉ bằng đọc code;
> - không sửa repo dog từ đây. Thay đổi cần phía dog được ghi thành yêu cầu.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | **Spike S-R3:** container ngoài compose dog thấy topic DDS (CycloneDDS, multicast tắt, peer theo tên) | spikes | — | `ros2 topic echo /dog1/imu/data` từ container riêng; ghi cấu hình cần thiết, kể cả yêu cầu phía dog nếu có |
| T02 | **Spike S-R5:** provider `kuksa.val.v2` bằng Python (grpcio): claim actuator, nhận BatchActuate, PublishValues 50 Hz × 10 phút; đo độ trễ app→broker→provider; lease qua metadata có khả thi không | spikes | M22-T06 | Số đo p50/p95; kết luận lease |
| T03 | **Spike S-R6:** build `dog_interfaces` (repo dog đúng SHA) trong image `FROM ros:humble-ros-base-jammy@sha256:566b87e6…`; import trong rclpy | spikes | — | Image build được; NOTICE Apache-2.0 |
| T04 | Engine mapping: đọc `mapping.vspec`, transform danh sách đóng, `maxRateHz`, QoS; test bằng fixture message/JSON thật của dog | protobus (mới) | T02, T03 | Unit test mỗi transform; fixture có nguồn |
| T05 | Adapter `dog-control/1` (**S-R4**): học `config_hash`, `issued_at_ns` theo `/clock`, `request_id`, chờ ack, `LastResult`, enum động tác, làm mới `manual` 20 Hz có TTL | protobus | T04 | Test với fixture + live: arm ⇒ MANUAL; manual 0,3 m/s ⇒ đi; ngừng ⇒ dừng ≤ 0,5 s; BOW ⇒ SUCCEEDED |
| T06 | Luật an toàn ADR-0066 §4: allowlist publisher, STOP ưu tiên, `allowRemoteArm`, lease (theo kết luận T02), `Robot.Connection.*` | protobus | T05 | Fault test: robot tắt, hash sai, ack timeout, broker/provider restart, STOP giữa động tác; test tĩnh allowlist publisher |
| T07 | Compose profile `robot`: `protobus-broker` (KUKSA digest ghim, `--vss rss`), `protobus-ros2`; external network `SV_ROBOT_NETWORK`; healthcheck; port 127.0.0.1; `capabilities.json` | protobus, meta | T06 | `docker compose -f modules/protobus/compose.yaml config -q`; root compose valid; không docker.sock |
| T08 | Quan sát: log dạng trace mỗi lệnh, metrics (tần số, tuổi dữ liệu, lệnh bị từ chối); signal-gateway trỏ được protobus-broker | protobus, orchestrator | T07 | Signals panel (cờ `SV_ROBOTICS`) đọc `Robot.*` live |
| T09 | Đóng milestone: gate live trên dog sim, báo cáo `docs/reports/M23.md`, BASELINE thêm pin ROS/dog | all | T01–T08 | Gate PASS |

## Acceptance gate (live trên dog sim, local; CI dùng fixture)
1. ≥ 20 leaf RSS khớp topic gốc, sai số theo transform.
2. ARM, manual, BOW, LIFT_FRONT_LEFT, JUMP, STOP đúng như ADR-0066 Verification.
3. Ngừng làm mới vận tốc ⇒ robot dừng ≤ 0,5 s (đo từ `/dog1/cmd_vel/safe`).
4. Fault test T06 PASS. Không có publisher ngoài allowlist.
5. Chạy 30 phút không rò bộ nhớ, tần số publish ổn định.

## Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| DDS không thấy nhau giữa hai compose project | T01; phương án chạy `protobus-ros2` trong compose dog (do repo dog include) |
| Lease không áp được trong KUKSA | Lease ở orchestrator: một run robot mỗi broker (ADR-0066 §4.5) |
| Repo dog private ⇒ CI không có | Fixture có nguồn + live local; chờ PO quyết quyền CI (design §11 RR6) |

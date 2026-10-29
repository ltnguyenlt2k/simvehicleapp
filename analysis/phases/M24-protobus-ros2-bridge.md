# M24: Protobus bridge ROS 2 + adapter dog + luật an toàn (live trên dog sim)

> **Yêu cầu:** PO 2026-10-27. Tín hiệu RSS qua Protobus đổi sang ROS 2 tới đúng chỗ nhận/điều khiển.
> **Thiết kế:** [design](../../docs/design/M22-robotics-extension.md) §2.1, §5.3, §5.5.
> **ADR:** [0066](../adr/ADR-0066-protobus-rss-ros2-bridge.md) — Accepted for implementation 2026-10-29; gates OPEN.
>
> **Phụ thuộc:** gate M23 PASS; kết luận S-R1, S-R2, S-R3 (M22). Chạy song song được với M25.
>
> **Nguyên tắc:**
> - bridge chỉ publish `control/request`;
> - không sửa repo dog từ đây;
> - CI dùng fixture, live chạy local (RR6).

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | Image `protobus-ros2`: `FROM ros:humble-ros-base-jammy@sha256:566b87e6…`, build `dog_interfaces` từ repo dog đúng SHA, NOTICE Apache-2.0; image build trên CI | protobus | — | Image build; `import dog_interfaces` |
| T02 | Engine mapping `mapping.v1`: subscribe topic, field/json, transform đóng, QoS, `maxRateHz`; `Samples` theo lô lên broker | protobus | T01 | Unit test mỗi transform với fixture có nguồn |
| T03 | Adapter `dog-control/1`: `config_hash`, `issued_at_ns` theo `/clock`, `request_id`, ack, làm mới `manual` 20 Hz theo hạn TTL broker, ánh xạ `motion/state`/`mission` về vòng đời chuẩn | protobus | T02 | Test fixture + live: Arm ⇒ MANUAL; Velocity 0,3 m/s ⇒ đi; BOW ⇒ SUCCEEDED |
| T04 | Luật an toàn: allowlist publisher (test tĩnh + runtime), Stop ưu tiên, `allowRemoteArm`, mất broker ⇒ ngừng làm mới (Brain dừng) | protobus | T03 | Fault test: hash sai, ack timeout, Stop giữa động tác, broker chết, bridge chết |
| T05 | Compose profile `live`: `protobus-live` + `protobus-ros2`, external network `SR_ROBOT_NETWORK` (network `robot` của dog), CycloneDDS theo S-R1, healthcheck | protobus, robotics | T04 | `compose config -q`; `sr up --live` nối được dog |
| T06 | Gate live trên dog sim (ADR-0066 Verification) + đo RAM toàn bộ (dog + sr) trên máy 11 GB | all | T05 | Bảng số đo; video ngắn hoặc log làm bằng chứng |
| T07 | Đóng milestone: `docs/reports/M24.md`, ROADMAP | all | T06 | Gate PASS |

## Acceptance gate (live trên dog sim, local; CI dùng fixture)
1. ≥ 20 sensor RSS khớp topic gốc theo sai số transform.
2. Arm, Velocity, Perform (BOW, LIFT_FRONT_LEFT, JUMP), GoTo, Stop đúng như ADR-0066 Verification.
3. Ngừng làm mới vận tốc ⇒ robot dừng ≤ 0,5 s (đo ở `/dog1/cmd_vel/safe`).
4. Fault test T04 PASS; không có publisher ngoài allowlist.
5. 30 phút không rò bộ nhớ, tần số ổn định.

## Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| DDS giữa hai compose project (RR1) | Theo kết luận S-R1; phương án repo dog include service bridge |
| Envelope dog đổi (RR2) | Adapter có version; contract test fixture |
| Thiếu RAM (RR8) | Dog không RViz; đo ở T06 |


## Amendment 2026-10-29

ADR-0069 is authoritative for integration and review R01–R08. Implementation authorized; no runtime gate has passed yet. M25 compiler/mock gate may proceed after M23; combined live acceptance requires M24. M26 technical gate precedes M27 final UI/video acceptance. CI source artifacts must be available before image gates.

T01 local image checkpoint 2026-10-29: image 0c28200aca2c, Python3.10/CycloneDDS/custom message type support and provenance checks PASS; pip check PASS; 8 runtime + 5 build lock entries OSV clean. Three build/environment failures retained in docs/reports/M24-progress.md. Image CI pending; T02 and live ROS gate remain OPEN.

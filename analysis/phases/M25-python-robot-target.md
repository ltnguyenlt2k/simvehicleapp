# M25: Target `python-robot` + runtime `svrobot` + Run trên protobus

> **Yêu cầu:** PO 2026-10-27 — "trình biên dịch riêng… ngôn ngữ nào dễ trước… runtime để kết nối robotic".
> **Thiết kế:** [design](../../docs/design/M22-robotics-extension.md) §6.
> **ADR:** [0067](../adr/ADR-0067-robot-app-target-python-first.md), [0066](../adr/ADR-0066-protobus-rss-ros2-bridge.md) §4.5 (lease) (Proposed — chờ PO xác nhận).
>
> **Phụ thuộc:** gate M23 và M24 PASS.
>
> **Nguyên tắc:**
> - cùng emitter Python với target `python`;
> - golden Python cũ không đổi;
> - parity bắt buộc;
> - app robot không import rclpy.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | Ghim `python:3.12-slim@sha256:…`; đo `toolchain-python` có đủ cho app robot không ⇒ quyết dùng lại hay tách `toolchain-python-robot` | compiler-code-python, velocitas-stack | — | Số đo kích thước/thời gian; ghi ADR-0067 Notes |
| T02 | Adapter `KuksaV2SignalAccess` không Velocitas (get/subscribe/actuate, trace, reconnect), `MqttPubSub` | compiler-code-python/runtime | — | Unit + test tích hợp với `protobus-broker` + provider mock |
| T03 | Target `python-robot`: template project Python thuần, `backend.yaml` (`signalSpec: [RSS]`), service `codegen-python-robot`, golden RW-A..RW-D | compiler-code-python | T02 | Golden ×2 tất định; golden Python cũ không đổi |
| T04 | Orchestrator: backend id `python-robot`, Project `signalSpec`, kiểm `ROBOT_SIGNAL_UNMAPPED` theo `capabilities.json`, signal-gateway trỏ broker theo miền | orchestrator | T03 | Unit orchestrator; contract test |
| T05 | Run robot: sandbox nối `protobus-broker`, lease điều khiển (theo kết luận M23-T02), STOP robot từ Run, dừng run ⇒ trả lease + vận tốc 0 | orchestrator, protobus | T04 | Test: hai run tranh một robot ⇒ run thứ hai bị từ chối; stop run ⇒ robot dừng |
| T06 | Parity simulator ↔ app RW-A..RW-D trên protobus + provider mock (cùng `robot-sim-profile`) | gate | T05 | 4/4, lệch ≤ 3 ms |
| T07 | (Phụ) `cpp-wasm`/`rust-wasm` chạy RW-A trên protobus chỉ bằng cấu hình `sv-wasm-host` | wasm-host | T05 | Ghi kết quả; không chặn gate |
| T08 | `@live` RW-A..RW-D trên dog sim; báo cáo `docs/reports/M25.md` | all | T06 | Gate PASS |

## Acceptance gate
- Golden robot ×2.
- Parity 4/4.
- `@live` RW-A..RW-D trên dog sim: robot làm đúng động tác/đường đi; trace Flow khớp.
- Lease và STOP có test.

## Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Image toolchain-python nặng vì Velocitas | T01 đo rồi quyết tách image |
| Provider mock lệch provider ROS 2 | Cùng engine mapping, chỉ thay nguồn ROS bằng profile vòng đời |

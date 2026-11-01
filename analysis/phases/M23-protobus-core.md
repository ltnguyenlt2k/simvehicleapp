# M23: Protobus core — broker, SafetyLane, provider mock

> **ADR:** [0066](../adr/ADR-0066-protobus-signal-broker-and-ros2-bridge.md), [0069](../adr/ADR-0069-robotics-safety-and-execution-policy.md), [0070](../adr/ADR-0070-robotics-performance-budget-low-spec.md). **Thiết kế:** [protobus.md](../../docs/design/robotics/protobus.md).
> **Phụ thuộc:** gate M22 PASS (đặc biệt S-R2).

## Mục tiêu
Broker tín hiệu RSS chạy độc lập: các ngữ nghĩa setpoint TTL, lease, command lifecycle và Stop riêng được chứng minh bằng test. Provider mock cho phép chạy workflow không cần ROS.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | `protobus.v1.proto` + catalog lỗi `PB1xxx` + sinh stub Python | robotics/contracts | — | Contract test; proto lint |
| T02 | Store + `Get`/`Subscribe` (giới hạn tần số, latest-wins, `lagged`, `STALE` theo `maxAgeMs`) | robotics/protobus | T01 | Unit + test tải nhỏ |
| T03 | Lease điều khiển + `SetSetpoint` + TTL → `safeValue` | robotics/protobus | T02 | Đo deadline TTL; lease mất ⇒ safe |
| T04 | `Execute`/`Cancel`: lifecycle + timeout + mất provider ⇒ `FAILED` + Stop | robotics/protobus | T02 | Đủ 5 terminal |
| T05 | `SafetyLane` listener riêng + xác nhận Stop từ provider | robotics/protobus | T03 | Stop p99 < 50 ms khi bão hoà telemetry |
| T06 | Provider mock: động học, động tác, pin, API scenario (timeline) | robotics/protobus | T02 | Cùng tập path profile `dog-go2-sim` |
| T07 | `pbctl` (get/subscribe/execute/stop) + audit ring buffer | robotics/protobus | T04 | Dùng được trong báo cáo |
| T08 | Image, compose service `protobus-broker`, `protobus-mock` (giới hạn RAM/CPU), healthcheck | robotics | T05–T06 | Compose valid; khởi động < 10 s |
| T09 | Gate + báo cáo M23 | docs | T01–T08 | `docs/reports/M23.md` |

## Trạng thái (2026-11-01)
T01–T09 ✔ — gate PASS, [báo cáo](../../docs/reports/M23.md).

## Acceptance Gate
- Toàn bộ unit/contract PASS trên CI.
- Benchmark lặp lại S-R2 trên broker thật vẫn đạt ADR-0070.
- Stop p99 < 50 ms dưới tải.

## Rủi ro
- Hiệu năng Python: giữ downsample và `latest-wins`; không thêm hàng đợi.

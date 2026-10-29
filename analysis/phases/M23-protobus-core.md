# M23: Protobus core — giao thức `protobus.v1`, broker, provider mock, `pbctl`

> **Yêu cầu:** PO 2026-10-27/28. Protobus độc lập, tự viết, không KUKSA.
> **Thiết kế:** [design](../../docs/design/M22-robotics-extension.md) §5.
> **ADR:** [0066](../adr/ADR-0066-protobus-rss-ros2-bridge.md) — Accepted for implementation 2026-10-29; gates OPEN.
>
> **Phụ thuộc:** gate M22 PASS (cần `rss-catalog.json` và số đo S-R3 cho profile vòng đời của mock).
>
> **Nguyên tắc:**
> - mỗi bất biến của broker (ADR-0066 §2) có ít nhất một test;
> - an toàn được kiểm bằng fault test, không chỉ đọc code.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | `protobus.v1.proto` (Bus + Provider), mã lỗi `PB_*`, schema `mapping.v1`, quy ước sinh stub Python trong từng module dùng | contracts | — | `buf lint`/`protoc` sạch; test tương thích ngược khung |
| T02 | **Spike S-R4:** broker tối thiểu asyncio + `grpcio`; đo 5 000 sample/s, 4 subscriber, p95, 30 phút, RAM | protobus | T01 | Số đo p50/p95/RAM; PASS ⇒ Python; FAIL ⇒ ADR Rust |
| T03 | Broker: nạp catalog, kiểm kiểu/khoảng/enum, store, `Get`, `Subscribe` on-change + `minIntervalMs`, `STALE` theo `maxAgeMs`, `Describe`, `catalogHash` khớp | protobus | T02 | Unit test mỗi luật |
| T04 | Lease (`Acquire/Renew/Release`, hết hạn, client mất kết nối), `SetTarget` + TTL ⇒ `SafeValueDispatch` | protobus | T03 | Fault test: app chết ⇒ safeValue ≤ ttlMs + 50 ms |
| T05 | Vòng đời lệnh: `Invoke` stream, timeout ⇒ Cancel, `Cancel`, `Stop` ưu tiên (không lease, vượt hàng đợi), provider offline ⇒ REJECTED, audit JSONL | protobus | T04 | Test: Stop khi 1 000 lệnh đang chờ ⇒ tới provider trước; audit đủ trường |
| T06 | Provider mock: động học unicycle, pin, profile vòng đời (số đo S-R3), API kịch bản, `timeScale`, `Robot.Connection.*` | protobus | T05 | Test: Perform khi Mode≠MANUAL ⇒ REJECTED; Velocity ⇒ pose đổi đúng; kịch bản đặt sensor đúng mốc |
| T07 | `pbctl` (get/subscribe/lease/set/invoke/cancel/stop) | protobus | T05 | Dùng được trong spike/fault test; `--help` đủ |
| T08 | Compose `protobus-sim` + `protobus-mock` (healthcheck, 127.0.0.1, không docker.sock); fault test tích hợp: broker restart, provider restart, mạng chập chờn | protobus, robotics | T06, T07 | `compose config -q`; fault test PASS trên CI |
| T09 | Đóng milestone: `docs/reports/M23.md`, ROADMAP | all | T01–T08 | Gate PASS |

## Acceptance gate
1. Mọi bất biến ADR-0066 §2 có test PASS.
2. S-R4 đạt ngưỡng (hoặc ADR Rust được PO duyệt).
3. Mock chạy đủ kịch bản mẫu.
4. Compose `protobus-sim` chạy độc lập.

## Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Python chậm (RR4) | S-R4 trước khi viết broker thật; gộp sample theo lô |
| Mock lệch robot thật | Thời lượng lấy từ số đo S-R3; UI ghi "mô phỏng" |


## Amendment 2026-10-29

ADR-0069 is authoritative for integration and review R01–R08. Implementation authorized; no runtime gate has passed yet. M25 compiler/mock gate may proceed after M23; combined live acceptance requires M24. M26 technical gate precedes M27 final UI/video acceptance. CI source artifacts must be available before image gates.

## Actual execution 2026-10-29

M22 scoped gate PASS (GitHub run 40874429999). T01: protoc build and 5 wire compatibility tests PASS; mapping schema and 5 negative/positive groups PASS in RSS image (20 total RSS/mapping tests). SIM safety-clock domain is explicitly local-host-only in PROTOBUS.md. No REAL/distributed-clock support implied.

T02: capped 10 s transport smoke PASS (approximately 5,049 samples/s, four subscribers, p95 0.71 ms). Full 1800 s measurement running as container sr-m23-s-r4; T03 must wait for full result. Initial smoke output permission failure retained; corrected non-root evidence uid and early writable-directory preflight. No performance threshold relaxed.

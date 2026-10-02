# ADR-0017: Simulator IR với virtual clock (TypeScript, trong `simvehicleapp-core`)

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L1
- **Related:** FR-RUN-01; Master Plan 7.4; ADR-0006, ADR-0012

## Decision
1. Package `@simvehicleapp/simulator` (thuần TS, không I/O) + endpoint `POST /simulate` trên `compiler`; có thể chạy trong browser (Web Worker) cho phản hồi tức thì — cùng code.
2. Kiến trúc: `VirtualClock` (min-heap sự kiện theo `t`, `seq`), `Strand` giả lập, `MockVehicle` (giá trị hiện tại + lịch sử writes), `MockMqtt`, `Tracer` phát **TraceEvent v1 cùng format runtime thật** (ADR-0027).
3. **Scenario v1** (YAML/JSON): `inputs: [{t, path|topic, value}]`, `until`, `initial: {path: value}`, `expect?: {writes: [...], trace?: [...]}` — dùng chung cho simulator, runtime conformance, integration test, parity.
4. Không giả lập độ trễ mạng mặc định; tuỳ chọn `latency: {read: 5, write: 5}` ms để phát hiện race logic.
5. Giới hạn: `until ≤ 24h virtual`, tối đa 1e6 sự kiện ⇒ `SIM_LIMIT_REACHED`.
6. UI: Scenario editor (bảng + ghi lại từ Signals panel), Timeline (signals & writes), Replay overlay.

## Mở rộng
Giá trị mảng (`T[]`) trong scenario/mock dùng JSON array thuần (đã tự nhiên hỗ trợ bởi format scenario hiện có); Simulator phải cài đúng `array.len/at/contains` giống runtime thật để giữ parity — xem [ADR-0018](ADR-0018-vss-array-and-full-datatype-coverage.md).

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| Chạy binary C++ với MockVehicle cho simulate | Cần build (chậm) |
| Dùng Sim executor | Ngữ nghĩa khác (ADR-0006) |

## Verification
Pass 100% conformance; GW-A..G expected.trace khớp; benchmark 10 phút virtual < 1 s.

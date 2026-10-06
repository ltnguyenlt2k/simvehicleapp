# ADR-0027: Live Run, log & trace streaming về UI

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L1
- **Related:** FR-RUN-03..06; [08](../08-run-debug-observe.md)

## Decision
1. Run = job `run` trên toolchain; orchestrator quản lý state machine ([08 §5](../08-run-debug-observe.md#5-run-lifecycle)).
2. Stream: toolchain SSE (`{seq, stream, line}`) → orchestrator `TraceIngest` (phân loại `SVTRACE` vs log; map `node`→`blockId` qua IR của generation) → lưu ring buffer `run_event` → SSE `/events?runId=` cho studio (resume bằng `Last-Event-ID` = seq).
3. Format dòng trace runtime: `SVTRACE {"v":1,"ts":<ms epoch>,"app":…,"wf":…,"run":<int>,"node":…,"ev":…,"data":{…}}` — một dòng, không xuống dòng trong JSON. Sự kiện hệ thống: `app.started`, `app.stopping`, `vdb.connected`, `vdb.disconnected`.
4. Log thường: parse level từ format logger SDK nếu nhận diện được, ngược lại `info`.
5. Backpressure: orchestrator gộp trace theo lô 50 ms; UI giới hạn 5 000 dòng hiển thị (virtualized list); trace level `node` có sampling khi > 500 ev/s (đếm vẫn đúng).
6. Signals: signal-gateway WS riêng (ADR-0024), proxy qua studio (auth).
7. Canvas overlay dùng chung component với Simulate replay.

## Verification
E2E: run GW-A → UI nhận `app.started` < 30 s sau build; highlight n2 khi Speed > 120; stop sạch trong 5 s; resume SSE sau reload trang không mất sự kiện (theo seq).

## Notes / Deviations (2026-10-07) — quan sát từ runtime C++ (M6), cho TraceIngest (M8)
- Logger của Velocitas SDK in mã màu ANSI không kết thúc dòng (`\x1b[0m`) nên một dòng `SVTRACE {...}` có thể bắt đầu bằng mã escape: TraceIngest phải bỏ các escape ANSI rồi mới nhận diện tiền tố `SVTRACE `.
- `ts` của dòng runtime là epoch ms; output `timestamp` của trigger và `now_ms` là ms đơn điệu từ lúc app khởi động (IR_SPEC `now_ms`).

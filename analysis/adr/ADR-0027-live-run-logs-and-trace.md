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

## Notes / Deviations (2026-10-07) — M8 (RunManager, TraceIngest, signals), theo uỷ quyền PO 2026-10-06, chờ PO xác nhận
1. **Run chỉ chạy generation mới nhất của project và generation đó phải thành công** (thư mục project chứa đúng code + binary của nó; một generation sau lỗi ở `test` để lại binary mới với trace map cũ). Một Run active trên stack (409 kèm `activeRun`); SynCode đang chạy ⇒ 409. Orchestrator khởi động lại ⇒ Run còn active bị dừng (stop job) và đánh `stopped` kèm diagnostic — không gắn lại vào app đang chạy.
2. **Trace level của Run chỉ hạ được** (`traceLevel` của request và `SV_TRACE_LEVEL` không vượt mức project đã sinh, analysis/08 §3.2): runtime `levelFromEnv` trước đây cho env nâng mức — sửa thành lấy min (gtest). **Sự kiện vòng đời `app.*`/`vdb.*` luôn được ghi** kể cả `off`, vì Run cần `app.started` để sang `running` (ngược lại mọi Run `off` sẽ `RUN_START_TIMEOUT`).
3. **TraceIngest:** bỏ mã ANSI rồi nhận `SVTRACE {…}` ở cuối dòng, kiểm schema `trace-event#/$defs/runtimeLine` (dòng sai ⇒ coi là log), map `node → blockId` qua `run_info.traceMap` lưu vào generation lúc SynCode (từ `src.blockId` của trigger/node trong IR). Log: level suy từ dạng `[ERROR]`/`WARN:`… của SDK. Log và trace chung một dãy seq của Run.
4. **Lấy mẫu (§5) dạng gộp, giữ đếm đúng:** quá 500 sự kiện node trong một giây ⇒ các `enter`/`exit`/`value` sau đó gộp theo (workflow, node, loại) trong mỗi lô 50 ms — giữ sự kiện cuối với `data.dropped` = số sự kiện nó đại diện thêm. Overlay cộng `1 + dropped`. Load test: 2 000 ev/s × 10 s ⇒ đếm enter/exit đúng tuyệt đối, luồng ra ≤ 500/s + 4/lô, 20 000 dòng xử lý ~50 ms.
5. **Lưu trước, phát sau** theo từng Run (một chuỗi promise): client nối lại hay mở trễ luôn thấy đủ sự kiện qua backlog + live (dedup theo seq); Run chỉ được đánh dấu kết thúc sau khi lô cuối đã lưu. `run_event` là ring 20 000 sự kiện mới nhất (Postgres, test thật). Agent của toolchain giữ 50 000 dòng mới nhất cho job `run` (seq vẫn tăng) thay vì ngừng ghi ở 50 000 như job build.
6. **Signals qua SSE + POST** (không WebSocket): BFF studio relay SSE như log (auth ở BFF), inject bằng POST — đổi contract skeleton `signal-gateway.v1` chưa từng triển khai (CHANGELOG contracts).
7. Gate backend chạy lại được: `modules/simvehicleapp-orchestrator/gate/m8-gate.sh` (GW-A live trên toolchain, databroker, gateway thật).

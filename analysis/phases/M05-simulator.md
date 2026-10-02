# M5 — Simulator & Simulate UI

**Mục tiêu:** bấm Simulate → thấy timeline và replay trên canvas trong < 1 s; pass conformance.
**ADR:** 0017, 0012 · **Phụ thuộc:** M4 · Master Plan Phase 13

## Tasks
| ID | Task | Module | Test |
|---|---|---|---|
| M05-T01 | VirtualClock + Strand giả lập + scheduler tất định (t, seq) | core/simulator | unit |
| M05-T02 | Interpreter opcode P0 (event.*, vehicle.*, control.branch/wait/stable_for/stop, state.*, comm.*) | core/simulator | conformance |
| M05-T03 | Concurrency policies restart/ignore/queue/parallel + cancel tokens | core/simulator | conformance |
| M05-T04 | P1 opcode: switch, wait_until, repeat, while (guard), parallel/join, condition trigger, write_many | core/simulator | conformance |
| M05-T05 | MockVehicle (cache, writes log, subscription fan-out), MockMqtt | core/simulator | |
| M05-T06 | Tracer TraceEvent v1 (cùng format runtime) + ScenarioPlayer (scenario.v1) | core/simulator | schema validate |
| M05-T07 | `POST /simulate` + giới hạn (24h virtual, 1e6 events) | core | perf 10 phút virtual < 1 s |
| M05-T08 | Build simulator cho browser (Web Worker) — tuỳ chọn khi latency service > 300 ms | studio | |
| M05-T09 | UI Scenario editor (bảng t/path/value, import/export YAML, "record from Signals" để dành M8) | studio | |
| M05-T10 | UI Simulation timeline (signals, writes, logs) + Replay overlay trên canvas (component `TraceOverlay` dùng lại ở M8) | studio | Playwright |
| M05-T11 | expected.trace/writes cho GW-A..G sinh từ simulator → review → đóng băng | contracts | |

## Gate
Conformance 100%; GW-A: Speed 100→130 tại t=1000, giữ tới 3000 ⇒ write Hazard=true tại t=3000; đổi Speed tại t=2500 ⇒ restart, write tại t=4500 (ví dụ kiểm chứng restart).

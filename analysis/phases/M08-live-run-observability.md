# M8 — Live Run headless, Signals, Log & Trace overlay

**Mục tiêu:** Run app đã build trên KUKSA thật (không mở IDE), inject tín hiệu từ UI, xem log/trace/tín hiệu realtime.
**ADR:** 0024, 0027 · **Phụ thuộc:** M7, M5 (TraceOverlay)

## Tasks
| ID | Task | Module | Test |
|---|---|---|---|
| M08-T01 | Compose runtime: databroker 0.5.0 (flags theo S-2), mosquitto, mock-provider (profile), mount VSS theo project | meta/velocitas-stack | compose smoke |
| M08-T02 | Hỗ trợ nhiều VSS release: 1 databroker/release trong compose (profile), map `SV_DATABROKERS` release→endpoint cho run & signal-gateway (ADR-0024 §6) | meta/orchestrator | test 2 release |
| M08-T03 | RunManager + state machine + 1 run active + stop/kill | orchestrator | |
| M08-T04 | toolchain `run` job: env SDV_* + `SV_TRACE_LEVEL`, stdout/stderr SSE, exit code | velocitas-stack | |
| M08-T05 | TraceIngest (SVTRACE parse, map node→block, batch 50 ms, sampling) + run_event ring buffer + SSE resume | orchestrator | load test 2k ev/s |
| M08-T06 | signal-gateway: kuksa.val.v1 client (proto pin 0.5.0), WS subscribe/set/snapshot, path allowlist từ catalog | orchestrator | integration |
| M08-T07 | Scenario player trên databroker thật (dùng scenario.v1) | orchestrator | |
| M08-T08 | UI Run console (virtualized, filter level, search), Signals panel (watch list, inject, current/target), Trace overlay live, nút Run/Stop | studio | Playwright |
| M08-T09 | "Record scenario from Signals" → scenario editor (M5) | studio | |
| M08-T10 | Smoke `scripts/smoke.sh` đầy đủ GW-A live | meta | CI nightly |

> Ghi chú M08-T02: container không có docker.sock nên không restart databroker từ bên trong được; vì vậy mỗi release có databroker riêng, khai báo sẵn trong compose.

## Gate
GW-A live: inject Speed 130 trong 3 s ⇒ Hazard.IsSignaling đổi (theo S-3) ⇒ UI thấy trace n2→n3 highlight và log; Stop sạch < 5 s; reload trang không mất log (SSE resume).

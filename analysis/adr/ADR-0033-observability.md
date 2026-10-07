# ADR-0033: Observability của chính hệ thống SimVehicleApp

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L1
- **Related:** NFR-08; Master Plan 13.2

## Decision
1. Log JSON 1 dòng mọi service: `{ts, level, service, version, requestId, generationId?, runId?, projectId?, msg, ...}`; `docker compose logs` là kênh mặc định.
2. Metrics Prometheus-format `GET /metrics` ở orchestrator, compiler, toolchain agent: thời gian mỗi stage SynCode, tỉ lệ fail theo diagnostic code, build duration (cold/warm), run count, trace events/s.
3. Profile `observability` (tuỳ chọn): Prometheus + Grafana dashboard mẫu; OpenTelemetry tracing (OTLP) P2 — Sim đã có `instrumentation*.ts` có thể nối vào.
4. UI trang "System status": healthz/version của mọi service + lock version.

## Verification
Một SynCode tạo chuỗi log truy vết được bằng `generationId` qua ≥ 5 service; `/metrics` có histogram stage.

## Notes / Deviations (2026-10-07) — M11-T05, theo uỷ quyền PO 2026-10-06, chờ PO xác nhận
1. **`/metrics` ở mọi service** (không chỉ orchestrator/compiler/agent): `service-kit` có registry (counter, gauge đọc lúc scrape, histogram ms) xuất định dạng Prometheus 0.0.4 và tự thêm `sv_http_requests_total{method,route,status}` + `sv_http_request_duration_ms` (route = đoạn đầu của path — không bao giờ có id). Orchestrator: `sv_syncode_stage_duration_ms{stage,state}`, `sv_syncode_generations_total{result,code}`, `sv_runs_ended_total{state,code}`, `sv_run_trace_events_total`, `sv_runs_active`; agent: `sv_toolchain_job_duration_ms{kind,state}` (build cold/warm = job `deps`/`build`). `/metrics` không đòi header nội bộ (như `/healthz`): chỉ truy cập được trong mạng nội bộ, không mang id/payload; service không bật registry thì `/metrics` vẫn cần xác thực.
2. **Tương quan log:** `service-kit` giữ request id trong một scope (`AsyncLocalStorage`): mỗi handler chạy trong scope của request, lời gọi nội bộ (`internalHeaders(undefined, …)`) mang id đó; worker SynCode chạy generation trong scope có id = `generationId`. Kiểm chứng: một SynCode có cùng `requestId = g_…` trong log của 6 service (orchestrator, compiler, vss-catalog, codegen-cpp, workspace, toolchain-cpp).
3. **System status:** orchestrator `GET /system` (health + version các service nó điều khiển), BFF `GET /api/sv/system`, trang studio "System status" (sidebar). `SV_COMMIT` = commit đang checkout, do `scripts/sv`/`refresh` truyền vào mọi service. "Lock version" sẽ hiện khi có lock release (M11-T10).
4. Profile `observability` (Prometheus + Grafana) chưa làm — P2.

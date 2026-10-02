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

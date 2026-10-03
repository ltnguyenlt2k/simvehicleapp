# ADR-0007: Phân rã service theo tầng & giao tiếp qua contract có version

- **Status:** Accepted (2026-10-03 — PO chấp thuận cùng Notes 2026-10-03; contracts 1.0.0-alpha.1 + service-kit, CI PASS run 37115615196) · **Date:** 2026-09-30 · **Level:** L0
- **Related:** FR-PLT-04/05, NFR-06; [02](../02-layers-and-modules.md), [03](../03-system-architecture.md); Master Plan Part 10

## Context
Luồng PO có 6 "ô" phải độc lập, dễ bảo trì. Master Plan Part 10 có package boundaries nhưng chưa tách repo/tầng. Cần quyết định số service, cách giao tiếp, ai sở hữu dữ liệu.

## Decision
1. **6 tầng** L1 Presentation, L2 Application, L3 Domain Core, L4 Language Backends, L5 Toolchain & Runtime, L6 Dev Tools — phụ thuộc chỉ đi xuống (ma trận [02 §4](../02-layers-and-modules.md)).
2. **Giao tiếp:** HTTP/JSON đồng bộ cho request ngắn; **SSE** cho stream job/log/trace tới UI; **WebSocket** cho signals; gRPC chỉ tới KUKSA. Không dùng message bus ở v1 (job queue Postgres trong orchestrator đủ).
3. **Contract** (JSON Schema 2020-12 + OpenAPI 3.1 + proto) nằm ở `simvehicleapp-contracts`, sinh types TS/Python/Rust. Semver; breaking ⇒ major + ADR.
4. **Sở hữu dữ liệu:** workflow graph — studio (DB Sim); project/generation/run — orchestrator (schema `sv`); file project — workspace-service (duy nhất ghi source); hội thoại AI — ai-assistant (schema `sv_ai`).
5. **Studio BFF** là biên giới bảo mật duy nhất với browser; service nội bộ tin nhau qua `INTERNAL_API_SECRET` (header `x-sv-internal`), không publish port.
6. **Correlation:** header `x-sv-request-id`, `generationId`, `runId` xuyên suốt log.
7. Mọi service: `GET /healthz`, `GET /version` (`{name, version, commit, contracts}`), log JSON một dòng (pino/structlog).

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| Gộp tất cả backend vào Next.js API routes của Sim | Vi phạm độc lập, khó thay ngôn ngữ, coupling Sim |
| Message bus (NATS/Kafka) | Quá mức cho v1; thêm vận hành |
| gRPC giữa các service | Browser cần HTTP/SSE; JSON Schema dễ dùng chung với IR |

## Consequences
+ Thay thế từng module, test contract độc lập. − Nhiều container (≈15) ⇒ cần compose profiles & bootstrap tốt.

## Implementation
| Task | Milestone |
|---|---|
| Contracts v1: WorkflowGraph, IR, Diagnostics, GeneratedFileSet, BackendCapabilities, Toolchain API, TraceEvent, LogLine, SignalUpdate, WorkflowPatch, Orchestrator API | M0 (draft) → khoá theo milestone dùng |
| Thư viện nhỏ `service-kit` (healthz/version/log/internal auth) — **nằm trong contracts repo dưới dạng package riêng** để không vi phạm luật phụ thuộc | M0 |

## Verification
Contract test ở mỗi module; dependency lint; chaos test: tắt 1 service → UI báo lỗi rõ, không crash.

## Notes / Deviations (2026-10-03 — M00-T05; PO chấp thuận cùng ADR)
Bằng chứng implement M0: `modules/simvehicleapp-contracts` (`@simvehicleapp/contracts@1.0.0-alpha.1`), 17 JSON Schema 2020-12 + OpenAPI 3.1 cho 8 service + TS types + `@simvehicleapp/service-kit`; 89 test; CI `contracts` + `contract-only-deps` PASS (GitHub Actions run 37115615196). Điểm cần PO xác nhận khi Accept:
1. `$id` dạng URN `urn:simvehicleapp:contracts:<name>:<semver>` (không phụ thuộc domain).
2. Mục 3 "proto + sinh types TS/Python/Rust": M0 chỉ sinh TS; Python (M12), Rust (M13), proto KUKSA (vendored ở orchestrator, M8) thêm khi có module tiêu thụ.
3. Mục 7 `/version`: schema `service-info` cho phép field bổ sung (vd toolchain ghi version CLI/SDK); `/healthz` trả `{status: ok|degraded, checks?}`, 503 khi degraded; hai endpoint này không cần `x-sv-internal`.
4. `service-kit` là package riêng trong module contracts, khai báo `@simvehicleapp/contracts` là peer dependency (dev resolve qua tsconfig paths — tránh vòng `file:../..`).
5. API orchestrator: `POST /projects/{id}/generations` nhận `graphs[]` (studio sở hữu graph theo mục 4, orchestrator không gọi ngược L1) thay cho `workflowIds[]` ở sơ đồ analysis/03 §5 — chốt khi M7 khoá API.
Danh sách đầy đủ: `modules/simvehicleapp-contracts/CONTRACT.md` §Alpha decisions.

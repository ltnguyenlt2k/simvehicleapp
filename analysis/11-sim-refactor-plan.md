# 11 — Kế hoạch refactor SimStudioAI → `simvehicleapp-studio`

> Baseline: `simstudioai/sim@v0.7.13` (`ad0b8678…`). Quyết định: [ADR-0003](adr/ADR-0003-upstream-baseline-and-fork-policy.md), [ADR-0004](adr/ADR-0004-license-compliance.md), [ADR-0008](adr/ADR-0008-sim-refactor-strategy.md), [ADR-0011](adr/ADR-0011-block-model-on-canvas.md).
> Nguyên tắc: **feature-flag trước, xoá sau** — *ngoại trừ* phần vướng license (`ee/`) và phần gọi dịch vụ độc quyền (copilot) phải gỡ ngay ở M1.

---

## 1. Bảng Giữ / Thay / Gỡ

| Khu vực (v0.7.13) | Quyết định | Khi | Ghi chú |
|---|---|---|---|
| `apps/sim/ee/**` | **GỠ NGAY** + stub | M1 | Sim Enterprise License. Tìm mọi `from '@/ee/…'` → thay stub no-op hoặc xoá tính năng (SSO, access-control, audit-logs, data-drains, data-retention, whitelabeling) |
| `apps/sim/lib/copilot/**`, `app/api/copilot/**`, hooks `copilot-*`, UI copilot panel | **GỠ** (thay bằng Assistant panel gọi `simvehicleapp-ai`) | M1 (flag off) → M10 (thay) | Gọi `copilot.sim.ai` độc quyền |
| `apps/pii`, `docker/pii.Dockerfile` | GỠ | M1 | Presidio sidecar không cần |
| `apps/docs` | GỠ (tài liệu riêng ở meta-repo) | M1 | |
| `.devcontainer/`, `helm/`, `docker-compose.ollama.yml` | GỠ | M1 | FR-PLT-02 |
| `apps/sim/blocks/blocks/*` (273 block AI/integration) | Ẩn khỏi toolbar bằng allowlist | M1 → xoá M11 | Chỉ giữ block core cần cho UX (không có) |
| `apps/sim/tools/**`, `connectors/`, `enrichments/`, `triggers/` (webhook SaaS) | Ẩn → xoá M11 | | |
| `apps/sim/providers/**` | **Tách/tái dùng** trong `simvehicleapp-ai` | M10 | Apache |
| `apps/sim/executor/**` | Không dùng cho vehicle workflow; giữ tới M11 rồi gỡ phần không cần | M11 | tránh coupling (R1) |
| `apps/sim/app/api/mcp` | Xem xét tái dùng phần MCP client | M10 | |
| Canvas (ReactFlow), workflow store, subblock store, edge-validation, auto-layout | **GIỮ + mở rộng** | M2–M3 | lõi UX |
| `packages/workflow-types`, `workflow-persistence`, `db` (Drizzle), `auth`(Better Auth), `realtime` | **GIỮ** | | thêm schema `sv` qua migration riêng |
| Billing, usage limits, marketing landing `app/(landing)`, blog, emails broadcast, templates marketplace | GỠ | M1 | |
| Logs/Executions UI của Sim | Thay bằng Run console + Generation history | M8 | |
| Branding: tên "Sim", logo, domain `sim.ai`, màu | **Thay toàn bộ** → SimVehicleApp | M1 | Trademark; giữ attribution trong NOTICE |

## 2. Điểm mở rộng cụ thể trong Sim (nơi agent sẽ sửa)
| Mục đích | File/khu vực (v0.7.13) | Thay đổi |
|---|---|---|
| Đăng ký block vehicle | `apps/sim/blocks/registry.ts`, `apps/sim/blocks/blocks/` | Thêm thư mục `apps/sim/blocks/vehicle/` + 1 dòng import registry ([ADR-0011](adr/ADR-0011-block-model-on-canvas.md)) |
| Toolbar | component toolbar trong `app/workspace/[workspaceId]/w/[workflowId]/components/…` (agent tìm chính xác bằng grep `hideFromToolbar`) | Thêm panel "Vehicle signals" (cây VSS lazy-load từ catalog) + lọc allowlist |
| SubBlock kiểu mới | `packages/workflow-types/src/blocks.ts` (`SubBlockType`) + renderer subblock | `vss-path-selector`, `sv-expression`, `sv-duration`, `sv-enum` |
| Nút SynCode/Simulate/Run/Stop/IDE/Export | control bar của workflow editor | thêm action group |
| Bottom dock panels | layout editor | Problems, Simulation, Run console, Signals, Build log |
| Assistant panel | thay copilot panel | chat UI gọi `/api/sv/ai/chat` |
| BFF | `apps/sim/app/api/sv/**` (mới) | proxy có auth tới services; SSE/WS passthrough |
| Export graph | `apps/sim/lib/sv/graph-adapter.ts` (mới) | `toWorkflowGraph()` thuần + golden test |
| Env | `apps/sim/lib/core/config/env.ts` | thêm biến `SV_*` (zod) |
| DB | `packages/db` | migration schema `sv` (project, generation, run…) — hoặc để orchestrator sở hữu schema (khuyến nghị: orchestrator sở hữu, studio chỉ đọc qua API) |

## 3. Quy trình gỡ `ee/` an toàn
1. `grep -rn "@/ee/\|/ee/" apps packages` → danh sách import.
2. Với mỗi import: nếu tính năng không cần → xoá route/component gọi nó; nếu cần interface → tạo stub `apps/sim/lib/sv/stubs/<name>.ts` trả giá trị "disabled".
3. Xoá `apps/sim/ee/`, bỏ env `ENTERPRISE_ENABLED`, `NEXT_PUBLIC_ACCESS_CONTROL_ENABLED`…
4. `bun run build` + `bun test` + license scan (không còn file có header Sim Enterprise).
5. Ghi ADR-0004 phần "Kết quả gỡ".

## 4. Rebrand checklist
- `package.json` name/description, `apps/sim/public/*` logo/favicon, metadata Next (`title`, OG), email templates, text UI "Sim" → "SimVehicleApp", link docs → docs nội bộ, telemetry (tắt mặc định: `telemetry.config.ts` → no-op).
- Giữ `LICENSE` Apache-2.0 + `NOTICE` gốc của Sim và thêm dòng: "This product includes software developed by Sim Studio, Inc. (Apache-2.0), modified by <Company>".
- Kiểm tra trademark tên "SimVehicleApp" với pháp chế (risk ghi ở [15](15-risks-and-open-questions.md)).

## 5. Chế độ chạy duy nhất
- Một `Dockerfile` cho studio (dựa `docker/app.Dockerfile`), một cho realtime, một migrations — build trong meta-repo compose.
- `DISABLE_AUTH=true` hỗ trợ chế độ single-user local (mặc định **false**; `.env.example` ghi rõ).
- Bỏ Trigger.dev nếu không cần (background jobs thay bằng orchestrator queue) — xác minh trong M1 rằng các luồng còn giữ không phụ thuộc Trigger.dev.

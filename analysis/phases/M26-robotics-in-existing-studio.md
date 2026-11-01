# M26: Miền Robot trong GUI SimVehicleApp hiện có (+ control API, runner, trợ lý AI)

> **ADR:** [0064](../adr/ADR-0064-robotics-architecture-shared-gui-independent-execution.md), [0068](../adr/ADR-0068-robotics-domain-in-existing-studio.md), [0069](../adr/ADR-0069-robotics-safety-and-execution-policy.md), [0070](../adr/ADR-0070-robotics-performance-budget-low-spec.md). **Thiết kế:** [gui-integration.md](../../docs/design/robotics/gui-integration.md).
> **Phụ thuộc:** gate M25 PASS; M24 PASS cho phần Run `ros-sim`.
> **Luật:** **KHÔNG** tạo GUI/editor/portal robot riêng (ADR-0064 §1). Mọi thay đổi studio đánh dấu `// SV:` khi chạm file gốc Sim (skill `sim-fork-refactor`); hồi quy xe là gate.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | I01: khảo sát chi tiết điểm gắn (đối chiếu bảng [gui-integration §2](../../docs/design/robotics/gui-integration.md)), kế hoạch migration, danh sách test xe bị ảnh hưởng | studio, docs | — | Ghi Notes ADR-0068 |
| T02 | Bảng `sv_robot_workflow_settings` + migration `0254` + route settings + sidecar export/import | studio (db, api, lib/sv) | T01 | Test route/migration; xe không đổi |
| T03 | Snapshot `rf-block-specs.json` + factory `blocks/robot/` + parity CI + palette lọc theo miền | studio | T01, M25-T02 | Parity PASS; toolbar xe giữ nguyên |
| T04 | `robot-graph-adapter.ts` thuần + golden + từ chối trộn miền | studio | T03 | Golden round-trip |
| T05 | `robotics/control` (build bất biến, deploy, runs Start/Stop/SSE, scenarios; chỉ nhận header nội bộ) + `robotics/runner` (không root, mode network tách) + compose | robotics | M25 | Unit/HTTP; runner từ chối artifact sai hash |
| T06 | BFF `/api/sv/robotics/*` + service `robotics`/`robotflow` trong `api-client`/env + overlay `compose.robotics.yaml` | studio | T05 | 401/403/404; không route nhận URL/code từ client |
| T07 | RSS path selector + Problems `RF*` + quick-fix | studio | T04, T06 | Vitest + E2E mock |
| T08 | Test tab robot (scenario trên mock) | studio | T06 | E2E: PASS và FAIL có lý do |
| T09 | Build/Deploy + Run dock (Start xác nhận, Stop luôn hiện, Flow, Signals ≤ 10 Hz, Console) + nút *Mở Robot Zoo* | studio | T06 | E2E mock + đo long task |
| T10 | Trợ lý AI theo miền (tools ADR-0068 §6); provider `.env` (openai-compatible `local-agent`); eval ≥ 10 ca robot với model thật | simvehicleapp-ai, studio | T07 | Tool test; eval có số đo thật (không giả nếu endpoint lỗi) |
| T11 | E2E Playwright GUI thật: soạn → lint → Test → build → deploy → Start/Stop (mock + `ros-sim`) + toàn bộ E2E xe | studio e2e | T02–T10 | CI xanh + `@live` local |
| T12 | Gate + báo cáo M26 + user guide nháp `docs/user-guide/robotics.md` | docs | T11 | `docs/reports/M26.md` |

## Acceptance Gate
- E2E chứng minh workflow robot được soạn và chạy **trong studio hiện có**.
- `robotics/compose.yaml` không có service web soạn thảo.
- Toàn bộ CI/E2E xe PASS.

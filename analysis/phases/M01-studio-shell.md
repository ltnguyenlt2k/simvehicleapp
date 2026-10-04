# M1 — Studio shell (fork Sim, gỡ license/AI độc quyền, rebrand, compose)

**Mục tiêu:** `simvehicleapp-studio` chạy trong compose, sạch license, không copilot, toolbar chỉ còn khung nhóm vehicle (rỗng), có BFF skeleton.
**ADR:** 0003, 0004, 0008 · **Phụ thuộc:** M0 · **Tham chiếu:** [11-sim-refactor-plan](../11-sim-refactor-plan.md)

**Điều kiện bắt đầu:** gate M0 PASS và ADR trên Accepted. Trước khi xác nhận M01-T02c, phải build/test image từ source đã sửa. S-5 dùng prebuilt chỉ là bằng chứng baseline; [spike report §8](../../docs/spikes/M0-spikes-report.md#8-sim-from-source) ghi source build chưa thành công trên host thử nghiệm, nguyên nhân lần treo chưa xác minh. Đo lại có scope hoặc dùng máy/CI đủ tài nguyên; không dùng image upstream để chứng minh bản refactor.

## Tasks
| ID | Task | Kết quả / vị trí | Test |
|---|---|---|---|
| M01-T01 | Tạo fork từ `v0.7.13`, tag `baseline-v0.7.13`, `UPSTREAM_SYNC.md` | repo studio | merge-base check |
| M01-T02a | Viết spec clean-room từ phía Apache (đã có bảng symbol ở [11a §2](../11a-ee-clean-room-replacement.md)) — chữ ký suy từ 61 call site + API route + schema | spec | review: không trích `ee/` |
| M01-T02b | Tự viết `lib/sv/oss/{brand,access-control,ui}` (allow-all permission-check, brand từ env) + contract test | | unit test |
| M01-T02c | Codemod `@/ee/*` → `@/lib/sv/oss/*`, xoá call site data-drains/data-retention/SSO/audit UI, **xoá `apps/sim/ee/`** | | build + test; CI guard `apps/sim/ee` & `@/ee/` |
| M01-T03 | Gỡ copilot: `lib/copilot/**`, `app/api/copilot/**`, hooks `copilot-*`, panel UI → placeholder "Assistant (coming in M10)" | | build; grep `copilot.sim.ai` rỗng |
| M01-T04 | Gỡ `apps/pii`, `apps/docs`, `.devcontainer`, `helm`, compose cũ, Trigger.dev (nếu S-5 xác nhận không cần) | | build |
| M01-T05 | Toolbar allowlist: env `SV_TOOLBAR_ALLOWLIST` mặc định `sv_*`; ẩn toàn bộ 268 block thật của Sim trừ `note.ts` (xem danh sách xoá/giữ/tham khảo từng cái ở [11b](../11b-block-inventory-and-migration.md)); ẩn integrations/tools/marketplace/templates/billing/landing routes (redirect về workspace) | `blocks/registry.ts` (`// SV:`), toolbar component | UI test snapshot toolbar |
| M01-T06 | Rebrand: `lib/sv/brand.ts` (tên, logo, màu), metadata, favicon, email templates, NOTICE attribution | | visual check, grep "Sim Studio" chỉ còn NOTICE |
| M01-T07 | Tắt telemetry mặc định (`telemetry.config.ts`), bỏ analytics bên ngoài | | network test: không request ra ngoài khi idle |
| M01-T08 | Dockerfiles `docker/{app,realtime,migrations}.Dockerfile` cho compose meta | | compose up |
| M01-T09 | BFF skeleton `/api/sv/health` gom healthz các service; `lib/sv/api-client.ts`; env zod `SV_*` | | route test |
| M01-T10 | Layout editor: thêm action bar (Verify/Simulate/SynCode/Run/Stop/Open IDE/Export — disabled), bottom dock rỗng 5 tab, banner an toàn (NFR-10) | components/sv/* | Playwright snapshot |
| M01-T11 | Scratch opcode denylist + Sim-EE path guard trong CI | CI | |
| M01-T12 | Kiểm tra i18n (Q8) & ghi kết quả | report | |

## DoD
- [x] Không còn `ee/`, copilot, pii; license scan xanh. — studio_guards + tree check + license scan (CI 37144577397).
- [x] Đăng nhập, tạo workspace, tạo workflow rỗng, lưu, realtime collab hoạt động. — Playwright E2E 4/4.
- [x] UI mang thương hiệu SimVehicleApp, toolbar không hiển thị block cũ. — E2E + xác nhận bằng mắt.

## Acceptance Gate
Build + test (`bun run test`) xanh; compose up; E2E: signup → tạo workflow → reload thấy workflow; license scan PASS.

**Gate M1: PASS (2026-10-04)** — [docs/reports/M01.md](../../docs/reports/M01.md), CI [37144577397](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37144577397).

# ADR-0008: Chiến lược refactor Sim thành `simvehicleapp-studio`

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L0
- **Related:** FR-PLT-01/06; [11](../11-sim-refactor-plan.md), [11b — kiểm kê từng block cụ thể](../11b-block-inventory-and-migration.md); ADR-0003, ADR-0004

## Context
Sim v0.7.13 có 273 block, copilot độc quyền, enterprise, billing, marketing… SimVehicleApp chỉ cần canvas + store + auth + realtime + khung UI.

## Decision
1. **Ba đợt:**
   - *Đợt 1 (M1)*: gỡ ngay phần vướng license/dịch vụ độc quyền (`ee/`, copilot backend, pii, docs app, devcontainer/helm), rebrand, allowlist toolbar (ẩn toàn bộ block cũ), tắt telemetry.
   - *Đợt 2 (M2–M10)*: thêm phần vehicle (blocks, panels, BFF, assistant) trong thư mục riêng `apps/sim/**/sv/` hoặc `apps/sim/blocks/vehicle/` để diff rõ.
   - *Đợt 3 (M11)*: xoá block/tools/connectors/executor handlers không dùng, dependency thừa; đo bundle size/build time.
2. Mọi thay đổi vào file Sim gốc **tối thiểu** và đánh dấu `// SV:` comment để dễ cherry-pick bảo mật từ upstream.
3. DB: không drop bảng Sim; thêm migration mới cho phần studio cần; dữ liệu `sv` do orchestrator sở hữu.
4. Feature flags qua env `SV_FEATURE_*` (zod trong `env.ts`).

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| Viết UI mới từ đầu (ReactFlow thuần) | Mất auth/collab/persistence đã có; PO yêu cầu tái sử dụng |
| Giữ toàn bộ Sim, chỉ thêm block | Rối UX, license EE, copilot độc quyền |

## Consequences
+ Nhanh có UI chạy được. − Codebase lớn trong giai đoạn đầu (build chậm) tới M11.

## Implementation
Xem [phases/M01](../phases/M01-studio-shell.md) và [phases/M11](../phases/M11-hardening-release.md).

## Verification
Toolbar chỉ hiện nhóm vehicle; `grep -ri "copilot.sim.ai\|sim.ai" apps` rỗng (trừ NOTICE); build & test xanh.

## Notes / Deviations (2026-10-03 — M1 implemented, chưa đổi Status)
Bằng chứng: [docs/reports/M01.md](../../docs/reports/M01.md); mọi thay đổi so với Sim v0.7.13 khai báo trong `modules/simvehicleapp-studio/UPSTREAM_SYNC.allow` và kiểm bằng CI `vendored-trees`.
1. **Copilot = cả module Chat/Mothership** (trang chủ workspace, chat, scheduled tasks, inbox, settings) ⇒ gỡ toàn bộ ở đợt 1; giữ 45 helper cục bộ không gọi mạng trong `lib/copilot` (Files, telemetry). Route `home`/`chat` cũ chuyển hướng về `/w` ở proxy.
2. **Terminal executor của Sim** được thay bằng bottom dock SimVehicleApp trong editor (khớp ADR-0006: không dùng executor Sim cho vehicle workflow).
3. **Trigger.dev** giữ ở trạng thái ngủ (backend `database` khi tắt cờ), gỡ SDK ở đợt 3 (M11).
4. **License-driven** (ADR-0004): gỡ tool Speech-to-Text + `ffmpeg-static` (GPL) ở M1 thay vì M11.
5. Toolbar allowlist qua `NEXT_PUBLIC_SV_TOOLBAR_ALLOWLIST` (cần tiền tố public vì chạy client) thay cho `SV_TOOLBAR_ALLOWLIST`.
6. Fragment compose cần `NEXT_PUBLIC_SOCKET_URL` (CSP production) để collaboration realtime hoạt động.

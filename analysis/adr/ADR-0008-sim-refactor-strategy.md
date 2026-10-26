# ADR-0008: Chiến lược refactor Sim thành `simvehicleapp-studio`

- **Status:** Accepted (2026-10-04 — PO chấp thuận cùng Notes 2026-10-03; M1 gate PASS) · **Date:** 2026-09-30 · **Level:** L0
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

## Notes / Deviations (2026-10-03 — M1 implemented; PO chấp thuận cùng ADR 2026-10-04)
Bằng chứng: [docs/reports/M01.md](../../docs/reports/M01.md); mọi thay đổi so với Sim v0.7.13 khai báo trong `modules/simvehicleapp-studio/UPSTREAM_SYNC.allow` và kiểm bằng CI `vendored-trees`.
1. **Copilot = cả module Chat/Mothership** (trang chủ workspace, chat, scheduled tasks, inbox, settings) ⇒ gỡ toàn bộ ở đợt 1; giữ 45 helper cục bộ không gọi mạng trong `lib/copilot` (Files, telemetry). Route `home`/`chat` cũ chuyển hướng về `/w` ở proxy.
2. **Terminal executor của Sim** được thay bằng bottom dock SimVehicleApp trong editor (khớp ADR-0006: không dùng executor Sim cho vehicle workflow).
3. **Trigger.dev** giữ ở trạng thái ngủ (backend `database` khi tắt cờ), gỡ SDK ở đợt 3 (M11).
4. **License-driven** (ADR-0004): gỡ tool Speech-to-Text + `ffmpeg-static` (GPL) ở M1 thay vì M11.
5. Toolbar allowlist qua `NEXT_PUBLIC_SV_TOOLBAR_ALLOWLIST` (cần tiền tố public vì chạy client) thay cho `SV_TOOLBAR_ALLOWLIST`.
6. Fragment compose cần `NEXT_PUBLIC_SOCKET_URL` (CSP production) để collaboration realtime hoạt động.

## Notes / Deviations (2026-10-07) — đợt 3 (M11-T03), theo uỷ quyền PO 2026-10-06, chờ PO xác nhận
1. **Đợt 3a (xong):** gỡ 221 block tích hợp bên thứ ba (nhóm `tools`) cùng thư mục tool, trigger, route `app/api/tools/<dịch vụ>`, connector knowledge, webhook provider và polling handler của chúng — 5 128 file, ~794 nghìn dòng; 20 dependency chỉ chúng dùng (client AWS, stagehand, linear, mongodb, mysql2, neo4j-driver, ajv). Giữ helper mà hạ tầng OAuth/credential/selector còn import (`tools/jira`, `microsoft_excel`, `sharepoint`, `gmail`, `crowdstrike`, `triggers/slack`, `tools/mistral` cho OCR knowledge base, `app/api/tools/ssh` cho handler `pi`). Gỡ nút Deploy/Run và phím Mod+Enter của Sim khỏi panel (chạy workflow Sim trên khối xe là vô nghĩa; vehicle app chạy bằng Run/Stop của thanh hành động). Đo trên CI: image studio 392 → 302 MB (−23 %), job dựng image + E2E 17 m 47 s → 10 m 28 s, type-check + test 7 m 37 s → 5 m 25 s. Type-check sạch, 566 file / 8 378 test vitest pass, `upstream_tree_check` PASS (mọi thay đổi khai báo trong `UPSTREAM_SYNC.allow`).
2. **Đợt 3b (follow-up, chờ PO):** block AI lõi của Sim (`agent`, `router`, `evaluator`, `guardrails`…: tham chiếu ở ~280 file executor/provider), hạ tầng OAuth/credential/selector của tích hợp đã gỡ, trang Integrations; nâng dependency lõi còn lỗ hổng (next, axios, sharp, tar, nodemailer, better-auth — cần ADR-0032 note vì better-auth đang ghim). Hiện các block đó đã ẩn khỏi toolbar (allowlist M1).


## Notes / Deviations (2026-10-07) — đợt 3b (M11-T03), theo uỷ quyền PO 2026-10-06, chờ PO xác nhận
1. **Phụ thuộc có lỗ hổng (osv-scanner, `bun.lock` studio): 74 → 19 gói** (1 trong 19 là false positive: advisory
   `simstudio` CLI ≤ 0.1.19, đã sửa upstream trước v0.7.13). Làm từng lô, mỗi lô: type-check + 8 399–8 446 test vitest +
   `upstream_tree_check` + CI (dựng image + E2E):
   - lô 1: 24 override cho gói bắc cầu một major (tar, axios, ws, postcss, hono, dompurify, mysql2, samlify…) + undici,
     js-yaml, echarts, mermaid;
   - lô 2: Next.js 16.2.6 → 16.3.7, better-auth (+sso, stripe) 1.6.11 → 1.6.33 (ADR-0032 note), sharp 0.35.5,
     nodemailer 10.0.13, MCP SDK 1.31.0, tiptap 3.30.5 (3.31 đổi round-trip markdown — giữ 3.30.5 cho mọi `@tiptap/*`);
   - lô 3: OpenTelemetry core/propagator-jaeger 2.9.0, vitest 4.1.11, trigger.dev 4.6.4, entry lock lồng cũ (undici,
     js-yaml, nanoid).
   Ràng buộc fork: `bunfig.toml` `minimumReleaseAge = 7 ngày` — chọn bản vá mới nhất đã quá 7 ngày (vd. Next 16.3.7 chứ
   không 16.3.8). Bài học: xoá entry lock lồng chỉ đúng khi bản ở gốc thoả range của cha (bun không tự thêm lại) —
   `docx/nanoid` (cần 5.x) phải khôi phục.
2. **Gỡ tính năng Sim kéo theo phụ thuộc lỗi:** trigger email IMAP (`imapflow` ⇒ nodemailer 7, 13 advisory) và block/
   handler Pi coding-agent + route SSH chỉ còn phục vụ nó (`@earendil-works/pi-coding-agent` ⇒ undici 8.3.0, 22 advisory;
   `ssh2`). Ẩn khỏi toolbar từ M1, không route SV nào dùng.
3. **Còn lại (không sửa được trong major hoặc cần nâng major của gói cha):** braces, csv-parse, deepmerge-ts, esbuild
   0.18 (dev), fflate, file-type, image-size, js-yaml 3, katex, postcss-selector-parser, protobufjs, sprintf-js, uuid,
   xlsx. Phần lớn nằm trong parser file/office, tailwind, OTel/posthog. Block AI lõi của Sim (`agent`, `router`…) vẫn
   giữ (gắn ~280 file executor) — gỡ là việc riêng.
4. **Next.js 16.3 chạy trên Node, không Bun (2026-10-08):** image studio với Next 16.3.7 trả 500 mọi trang — runtime
   server biên dịch của Next 16.3 không nạp được dưới Bun 1.3.13 ("Expected CommonJS module to have a function
   wrapper"). Cùng image chạy `node apps/sim/server.js` (Node 22 vốn có trong image cho isolated-vm) ⇒ `/signup` 200. Không
   lùi về 16.2.12 vì 3 advisory chỉ sửa ở 16.3 (RCE Image Optimization GHSA-2xp9-vwfh-vxw4, RCE `next/og`). CMD của
   `docker/app.Dockerfile` đổi sang `node`; code runtime không dùng API riêng của Bun (chỉ script build bundle).
   libvips 1.3.4 (sharp 0.35.5): thêm ngoại lệ LGPL cùng cơ sở với bản 1.2.x PO đã duyệt.
- 2026-10-14 (đợt 3c, bảo mật cùng major, theo uỷ quyền PO 2026-10-06 — chờ PO xác nhận): osv studio **20 → 14 gói**. `next`/`@next/env` 16.3.7 → 16.3.8 (6 advisory); OpenTelemetry 0.217/2.9 → 0.223/2.12 (`otlp-transformer` ≥ 0.221 bỏ hẳn `protobufjs` ⇒ hết protobufjs 8.0.1, 11 advisory); override `protobufjs` 7.6.5 (chỉ còn một major); lock lồng `gray-matter/js-yaml` 3.15.2, `posthog-js/fflate` 0.4.9, fflate 0.8.3. Mọi bản ≥ 7 ngày (`minimumReleaseAge`). Còn 14: cần nâng major (uuid 8/10→11, image-size 1→2, deepmerge-ts 7→8, csv-parse 6→7, katex →0.18, file-type 16→21, postcss-selector-parser 6→7, esbuild 0.18 dev) hoặc chưa có bản sửa (xlsx từ CDN, braces, sprintf-js, `packages/cli`) — chờ PO.

## Notes / Deviations (2026-10-25) — đợt 3b hoàn tất phần block AI (M21 D2, PO chấp thuận toàn bộ)
- **Đã gỡ** block LLM của Sim (`agent`, `router`/`router_v2`, `evaluator`, `guardrails`, `thinking`, `translate`, `tts`, `vision`/`vision_v2`, `image_generator`/`_v2`, `video_generator`/`_v2`/`_v3`, `enrichment`, `a2a`) khỏi registry và mã nguồn, cùng handler executor `agent`, `evaluator`, `router`. Từ đây không ai tạo, tải hay chạy được các block đó. Tiêu chí v1.0 (13 §5) "không còn block AI" ⇒ đạt cho **block**.
- **Giữ lại có chủ đích:** thư viện `providers/` của Sim và handler `mothership`. Lý do (đã kiểm source):
  - `providers/` còn được Knowledge Base (embedding), Tables (enrichment details), trợ lý viết code `wand`, giá trong Logs và trang landing dùng: 117 file;
  - các tính năng đó của Sim đã ẩn khỏi studio (allowlist M1, ADR-0056), không route `/api/sv/*` nào gọi;
  - gỡ hẳn nghĩa là viết lại các tính năng Sim đó, rủi ro hồi quy lớn và không có giá trị cho sản phẩm xe.
- **Nợ còn lại**, ghi để làm khi có nhu cầu tách fork sâu hơn:
  - gỡ `providers/` cùng Knowledge Base/Tables/wand;
  - gỡ handler `mothership`.
- Trợ lý AI của SimVehicleApp là module riêng (`simvehicleapp-ai`, ADR-0030), không dùng `providers/` của studio.
- **2026-10-25 (M21 D3, đợt 3d, bảo mật cùng major):** osv nightly 40194570658 có advisory mới từ sau 2026-10-14.
  - **Bản đã nâng** (mỗi bản ≥ 7 ngày theo `minimumReleaseAge`, kiểm registry npm 2026-10-25):
    - `next`/`@next/env` 16.3.8 → 16.4.2 (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr 9.5);
    - `dompurify` 3.4.17 (9.2);
    - `@modelcontextprotocol/sdk` 1.32.1;
    - `follow-redirects` 1.16.1;
    - `undici` 7.30.1;
    - `vite` 8.1.6;
    - `vitest`/`@vitest/*` 4.1.12;
    - `zod` 4.6.7 (override, cả bản lồng của better-auth/openai/trigger.dev);
    - `hono` 4.13.13;
    - `ip-address` 10.7.4.
  - **Ngoại lệ tuổi** (`bunfig.toml` `minimumReleaseAgeExcludes`): `fast-uri` 3.1.9. Đã ghim 2026-10-24 vì 4 advisory, nhưng bản phát hành 2026-10-19 chưa đủ 7 ngày nên bun từ chối khi resolve lại.
  - **Chờ đủ 7 ngày:** `nodemailer` ⇒ **10.1.7** (nâng 2026-10-26, messaging 79 test PASS); `body-parser` 2.4.0 (2026-10-22, đủ tuổi 2026-10-29).
  - **Major đã nâng (2026-10-26):**
    - `csv-parse` 7.0.3 (phụ thuộc trực tiếp; ESM-only, cùng API `parse`/`Options`/`Parser`; test table/file-parsers 371 PASS, tsc hẹp sạch);
    - override `uuid` 11.1.1 (Azure email, svix: API `v4` giữ nguyên, vẫn có CommonJS).
  - **Major không nâng, có lý do** (nâng sẽ làm vỡ gói cha, hoặc chỉ ở thời điểm build):
    - `image-size` 2: pptxgenjs gọi API v1 (default export bị bỏ). Chỉ dùng khi Sim xuất PPTX (đã ẩn).
    - `file-type` 21: officeparser dùng `require` v16, v21 chỉ có ESM. Chỉ dùng khi Sim đọc file Office cho Knowledge Base (đã ẩn).
    - `katex` 0.18: mermaid ghim ^0.16. Advisory 2.1.
    - `deepmerge-ts` 8: @prisma/config ghim 7.1.5, chỉ chạy lúc build/migration.
    - `postcss-selector-parser` 7: tailwindcss ghim ^6, chỉ chạy lúc build CSS.
    - `esbuild` 0.25: drizzle-kit/tsx, công cụ dev.
  - **Báo nhầm:** `simstudio` (CLI workspace) và `xlsx` 0.20.3 (bản CDN mới hơn bản advisory 0.17).

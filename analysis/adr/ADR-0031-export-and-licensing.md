# ADR-0031: Export project & điểm chặn license (entitlement)

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L1
- **Related:** FR-EXP-01/02; [10 §2–3](../10-ide-export-licensing.md#2-export--download)

## Decision
1. Export = zip project Velocitas đầy đủ (giữ `.devcontainer` của template để người nhận dùng workflow Velocitas chuẩn) + `.simvehicleapp/` (graph, IR, generation, license) + NOTICE/THIRD-PARTY; không build/cache.
2. **EntitlementService** (trong orchestrator) là PDP duy nhất; mọi hành động export/IDE/SynCode/ngôn ngữ/AI gọi `check(feature, context)`.
3. License = JSON ký Ed25519 (`edition, features{}, limits{}, expiry, licensee`) từ `SV_LICENSE_KEY`; `SV_LICENSE_MODE=full` (MVP) luôn allow nhưng vẫn log quyết định. Ký/verify bằng **`node:crypto` core** (`generateKeyPairSync('ed25519')`, `sign(null, data, privateKey)`, `verify(null, data, publicKey, signature)` — có sẵn từ Node ≥ 12, không cần thêm dependency); public key verify nhúng trong image orchestrator (biến môi trường hoặc file `.sv/license-public.pem`) để kiểm license **offline, không cần mạng**.
4. Tính năng giới hạn tương lai: `export.source`, `export.runtimeSource` (nếu tắt ⇒ runtime xuất dạng static lib prebuilt + header), `languages[]`, `maxProjects`, `ai.assistant`, `ide.access`.
5. License cho phần sinh ra (generated + runtime) ghi trong header file và `license.json` của gói; phần upstream giữ license gốc.

## Verification
Unit test PDP với license mẫu (full/restricted/expired); E2E export zip → build được bằng `app/Dockerfile` của template trên máy sạch.

## Notes / Deviations (2026-10-07) — M9, theo uỷ quyền PO 2026-10-06, chờ PO xác nhận
1. **Export = thư mục project như workspace có** (không build lại) + phần orchestrator thêm: `.simvehicleapp/workflows/<id>.graph.json` (WorkflowGraph của generation thành công mới nhất — nhập lại được), `.simvehicleapp/generation.json`, `.simvehicleapp/license.json` (khi có license hợp lệ), `README.SIMVEHICLE.md`, `NOTICE`, `THIRD-PARTY-NOTICES`. Không gửi IR (orchestrator chỉ giữ `irHash`; IR sinh lại được từ graph). Workspace bỏ `build*/`, `.git`, cache Velocitas, `node_modules`, symlink (không bao giờ đi theo), và mẫu trong `.svexportignore` (tập con gitignore: `#`, `*`, `**`, `/` cuối = thư mục); `generationId` khác generation đang có ⇒ 409. Zip **tất định** (mục sắp xếp, mốc thời gian DOS cố định 1980-01-01, mode Unix giữ bit chạy) — cùng project ⇒ cùng byte (test).
2. **EntitlementService** (`services/orchestrator/src/entitlements.ts`): License v1 JSON (hoặc base64) từ `SV_LICENSE_KEY`, chữ ký Ed25519 trên JSON chuẩn tắc (khoá sắp xếp mọi cấp, bỏ `signature`), khoá công khai `SV_LICENSE_PUBLIC_KEY` hoặc file `license-public.pem` trong image — kiểm offline bằng `node:crypto`. `features` **hạn chế, không cấp** (thiếu khoá = cho phép), `languages` giới hạn ngôn ngữ, `limits.maxProjects`, `expiry` (UTC, hết hạn sau ngày đó). `SV_LICENSE_MODE=full` (mặc định) cho phép mọi thứ nhưng vẫn đánh giá + log `entitlement` (biết license sẽ chặn gì); `enforce` áp dụng (không license hợp lệ ⇒ chặn). Điểm chặn: tạo project (`project.create`: ngôn ngữ, `maxProjects`), SynCode (`syncode` + ngôn ngữ), export (`export.source`), IDE (`ide.access` ⇒ không có `editor.url`); AI gắn ở M10. Từ chối ⇒ 403 `not_entitled` kèm lý do. `GET /entitlements` cho UI.
3. **Nhập lại (M09-T08):** studio nhận `.graph.json` (hoặc zip export — chỉ lấy `.simvehicleapp/workflows/*.graph.json`) qua bộ import sẵn có của Sim: `graphToSimState` là nghịch đảo của adapter (dàn khối theo cột từ trigger, container chứa con), ghim lại release VSS của graph. Round-trip kiểm trên 7 golden: graph → studio → adapter ⇒ cùng graph.
4. `export.runtimeSource=false` (runtime dạng thư viện dựng sẵn) chưa làm — chưa có bản build runtime nhị phân phát hành; ghi follow-up.

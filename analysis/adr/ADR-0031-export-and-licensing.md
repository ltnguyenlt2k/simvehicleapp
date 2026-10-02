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

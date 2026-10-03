---
name: license-compliance
description: Check dependencies, vendored upstream files, IDE extensions, notices or export packages against repository license rules.
---

# License compliance

Tham chiếu: ADR-0004, ADR-0031.

## Cấm
- Code/asset từ **Scratch** (`scratch-vm`, `scratch-gui`, `scratch-editor`, `scratch-blocks`) — AGPL-3.0 từ 2024-11-25. Không đọc source để "tham khảo cách làm"; chỉ dùng khái niệm trong `analysis/05` §3.
- Bất kỳ file nào từ `apps/sim/ee/**` (Sim Enterprise License) hoặc tính năng Enterprise của Sim (custom-blocks, SSO, SCIM, audit logs, access control, whitelabeling…).
- `ms-vscode.cpptools`, Pylance, extension Microsoft proprietary trong code-server.
- Dependency AGPL/GPL/SSPL/BUSL/Commons-Clause trong module sản phẩm (trừ khi ADR cho phép).

## Bắt buộc
- Giữ LICENSE + NOTICE gốc khi vendor (template Velocitas, proto KUKSA, providers Sim); thêm dòng "modified by SimVehicleApp".
- `THIRD-PARTY-NOTICES.md` sinh tự động cho mỗi image và gói export.
- Trước PR chạy `scripts/license/scan.sh` (cần `bun install --frozen-lockfile` của module trước; CI job `license-scan` làm việc này). Whitelist: `scripts/license/whitelisted-licenses.txt` (Apache-2.0, MIT, BSD-2/3, ISC, MPL-2.0 (file-level), Zlib, BSL-1.0, Unicode, CC0; EPL-2.0 chỉ image mosquitto nguyên bản). License ngoài whitelist chỉ chấp nhận cho dependency **dev-only** qua dòng có lý do trong `scripts/license/license-exceptions.txt`; denylist (GPL family, SSPL, BUSL, Commons-Clause) không bao giờ được ngoại lệ. Studio snapshot nằm ngoài phạm vi scan tới M1.
- Dependency mới ⇒ ghi license trong PR.

# ADR-0004: Tuân thủ license — gỡ Sim Enterprise, clean-room Scratch, extension hợp lệ

- **Status:** Proposed (cấu trúc quyết định đã chốt; Scratch denylist đã cụ thể hoá 2026-10-01 — xem Notes) · **Date:** 2026-09-30 · **Level:** L0
- **Related:** NFR-07, R11, R12, R16; [00 §1, §4, §6](../00-research-findings.md)

## Context
| Nguồn | License | Vấn đề |
|---|---|---|
| Sim (repo root) | Apache-2.0 | Được dùng thương mại, giữ LICENSE/NOTICE, ghi thay đổi |
| `apps/sim/ee/**` | **Sim Enterprise License**: chỉ dev/test; production cần subscription; **cấm modify/redistribute** | Không được ship |
| Scratch (`scratch-vm`, `scratch-editor`) | **AGPL-3.0** từ 2024-11-25 | Dùng code ⇒ phải mở toàn bộ source dịch vụ |
| Velocitas, KUKSA, SDK | Apache-2.0 | NOTICE bắt buộc trong export |
| VSS spec | MPL-2.0 | File VSS JSON phân phối kèm giữ license header/notice |
| Mosquitto | EPL-2.0/EDL-1.0 | Dùng image nguyên bản, không sửa |
| code-server | MIT | OK |
| MS C/C++, Pylance extension | Proprietary (chỉ VS Code chính thức) | Không cài trong code-server |

## Decision
1. **Gỡ `apps/sim/ee/` ở M1** và **thay bằng code tự viết theo quy trình clean-room** cho những giao diện core còn cần (brand, permission-check, InfoNote/SettingRow; SSO/audit-log UI về sau) — spec chỉ suy từ phía Apache (call site, API route, DB schema); người viết không đọc `ee/`. Chi tiết: [11a](../11a-ee-clean-room-replacement.md). Đây là ngoại lệ với luật "không mass-delete trước Phase 28" của master plan; tính năng không cần thì gỡ luôn call site.
2. **Clean-room với Scratch:** không mở/copy source Scratch trong quá trình implement; chỉ dùng khái niệm chung đã mô tả trong [05 §3](../05-blocks-and-execution-model.md#3-ngữ-nghĩa-thực-thi-execution-semantics). Không dùng tên opcode Scratch (`event_whenflagclicked`, `control_wait`, …), không dùng asset/icon Scratch. CI grep theo denylist cụ thể ở [scratch-opcode-denylist.md](scratch-opcode-denylist.md) (nguồn: Scratch Wiki — tài liệu công khai, không phải source code) → fail nếu trùng.
3. Không dùng Blockly/Scratch làm canvas (dùng ReactFlow sẵn trong Sim).
4. IDE chỉ dùng extension Open VSX có license cho phép (danh sách whitelist trong `ide-vscode/extensions.txt`).
5. Mọi repo con: `LICENSE` (Apache-2.0 mặc định cho phần mã nguồn mở của chúng ta, trừ khi ADR-0031 quyết định khác cho module thương mại), `NOTICE`, `THIRD-PARTY-NOTICES.md` sinh tự động.
6. CI license scan (ví dụ `license-checker`/`scancode-toolkit` + whitelist `whitelisted-licenses.txt` giống Velocitas) trên mọi repo.
7. Rebrand: bỏ tên/logo "Sim"; NOTICE giữ attribution Sim Studio, Inc.

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| Giữ `ee/` nhưng tắt bằng env | Vẫn là redistribute code EE ⇒ vi phạm |
| Fork Scratch bản BSD cũ (trước 11/2024) | Hợp pháp nhưng kéo theo codebase lớn không cần; rủi ro lẫn code AGPL mới |

## Consequences
+ Sản phẩm thương mại hoá được. − Mất SSO/audit-log/access-control của Sim ⇒ nếu cần phải tự viết (ADR-0032).

## Implementation
| Task | Milestone |
|---|---|
| Script `scripts/license/scan.sh` + whitelist; CI job ở mọi repo | M0 |
| Gỡ `ee/` + stub + test build | M1 |
| Scratch opcode denylist grep trong CI studio/core | M1 |
| Sinh THIRD-PARTY-NOTICES cho export | M9 |

## Verification
`find . -path '*apps/sim/ee*'` rỗng; license scan xanh; review checklist clean-room ký ở PR block/runtime; CI grep denylist rỗng.

## Notes / Deviations (2026-10-01)
- **Scratch denylist cụ thể hoá**: trước đây chỉ ghi "danh sách tên opcode Scratch phổ biến" mà không có danh sách thật ⇒ không thể implement CI. Đã tạo [scratch-opcode-denylist.md](scratch-opcode-denylist.md) với pattern ERE theo 10 tiền tố category chuẩn của Scratch (`motion_`, `looks_`, `sound_`, `event_`, `control_`, `sensing_`, `operator_`, `data_`, `procedures_`, `argument_`) + vài extension chính thức, nguồn Scratch Wiki (tài liệu công khai). SimVehicleApp dùng quy ước `namespace.verb` (dấu chấm) nên về cấu trúc không thể trùng — denylist chỉ là lưới an toàn bổ sung.
- **Không chỉ ee/ cần xử lý — còn `better-auth`/`@better-auth/sso` (MIT, pin `1.6.11` trong `apps/sim/package.json`) là plugin bên thứ ba độc lập với `ee/`**: `lib/auth/auth.ts` chỉ import duy nhất hằng số `SSO_TRUSTED_PROVIDERS` từ `@/ee/sso/constants` (một mảng tên provider, không phải logic) để truyền vào `sso({...})` của plugin MIT này. Nghĩa là **backend SSO không nằm trong `ee/`**, chỉ UI cấu hình/đăng nhập (`ee/sso/components/*`) mới cần viết lại clean-room — xem sửa tương ứng ở [ADR-0032](ADR-0032-auth-and-tenancy.md) và [11a §4](../11a-ee-clean-room-replacement.md). Tương tự, bảng `audit_log` đã có sẵn trong `packages/db/schema.ts` (Apache), không phải EE-only.
- **Dependency license cho backend khác (M12/M13)**: `velocitas-sdk` (PyPI, cần kiểm `whitelisted-licenses.txt` khi M12) và crate Rust `kuksa-rust-sdk`/`tonic`/`tokio` (M13) chưa có bước scan license cụ thể trong Implementation — bổ sung task "license scan Python/Rust deps" vào M12-T0x / M13-T0x khi viết phase chi tiết (hiện Implementation chỉ liệt kê `scripts/license/scan.sh` chung chung, cần mở rộng sang `pip-licenses`/`cargo-license` ở M12/M13).

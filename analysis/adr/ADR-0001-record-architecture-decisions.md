# ADR-0001: Ghi mọi quyết định kiến trúc bằng ADR

- **Status:** Accepted (quy trình đã áp dụng từ ADR-0002 trở đi, không có phản đối) · **Date:** 2026-09-30 · **Level:** L0
- **Related:** Master Plan v2 Part 15.1; [TEMPLATE](TEMPLATE.md)

## Context
Hệ thống gồm ~10 repo con, nhiều AI agent và dev cùng triển khai. Upstream (Sim, Velocitas, KUKSA) thay đổi nhanh; tài liệu và code thật sẽ lệch nhau. Cần một nơi duy nhất, có version, cho các quyết định.

## Decision
1. Mọi quyết định ảnh hưởng tới contract, cấu trúc repo, lựa chọn công nghệ, hoặc lệch khỏi analysis **PHẢI** có ADR.
2. ADR nháp ở `analysis/adr/` (Proposed); khi Accepted copy sang `docs/adr/` của meta-repo, và nếu chỉ liên quan một module thì thêm link trong `CONTRACT.md` của module đó.
3. Không sửa nội dung ADR đã Accepted; muốn đổi ⇒ ADR mới `Supersedes`.
4. Agent phát hiện sai khác tài liệu ↔ source thật ⇒ ưu tiên source thật + ghi mục "Notes / Deviations" hoặc ADR mới.
5. Số ADR: nhóm theo trăm chục — 000x hệ thống, 001x domain, 002x codegen/velocitas, 003x product/cross-cutting, 004x mở rộng.

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| Wiki ngoài repo | Không version cùng code, agent không đọc được |
| Chỉ comment trong code | Không có bối cảnh/phương án bị loại |

## Consequences
+ Agent có "constitution" rõ; review dễ. − Thêm chi phí viết (≈30 phút/ADR).

## Implementation
| Task | Module | Milestone |
|---|---|---|
| Tạo `docs/adr/` + skill `adr-writing` | meta | M0 |
| CI check: PR sửa `CONTRACT.md` hoặc schema phải link ADR | contracts | M0 |

## Verification
PR template có ô "ADR liên quan"; CI fail nếu schema major bump không kèm ADR.

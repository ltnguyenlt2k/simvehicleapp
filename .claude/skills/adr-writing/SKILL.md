---
name: adr-writing
description: Use when an architecture decision is made or changed, a contract/schema changes incompatibly, implementation deviates from the analysis documents, or a spike result must be recorded — writes or updates an ADR in the SimVehicleApp format.
---

# Viết ADR

Tham chiếu: `analysis/adr/TEMPLATE.md`, `analysis/adr/README.md`, ADR-0001.

## Khi nào
Quyết định công nghệ/cấu trúc; breaking contract; lệch analysis ↔ source thật; kết quả spike thay đổi giả định; thêm module/tầng mới.

## Cách
1. Chọn số theo nhóm: 000x hệ thống · 001x domain/authoring · 002x codegen/Velocitas · 003x product/cross-cutting · 004x mở rộng. Không dùng lại số.
2. Copy `TEMPLATE.md` → `ADR-XXXX-<slug>.md`; điền Context (có dữ kiện + link/commit), Decision (PHẢI/KHÔNG ĐƯỢC, đo được), Diagram (mermaid khi có luồng), Alternatives (bảng), Consequences, Implementation (task→milestone), Verification.
3. Thêm vào bảng + cây mermaid trong `analysis/adr/README.md`.
4. Status `Proposed`; khi Accepted: copy sang `docs/adr/`, cập nhật Status + ngày.
5. Không sửa nội dung ADR Accepted — viết ADR mới `Supersedes ADR-YYYY` và đổi status ADR cũ.
6. Sai khác nhỏ khi implement: thêm mục `Notes / Deviations` (ngày, mô tả, bằng chứng).

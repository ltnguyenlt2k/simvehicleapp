---
name: adr-writing
description: Record SimVehicleApp architecture or contract changes, upstream mismatches and spike decisions using the repository ADR format.
---

# Viết ADR

Tham chiếu: `analysis/adr/TEMPLATE.md`, `analysis/adr/README.md`, ADR-0001.

## Khi nào
Quyết định công nghệ/cấu trúc; breaking contract; lệch analysis ↔ source thật; kết quả spike thay đổi giả định; thêm module/tầng mới.

## Cách
1. Chọn số theo nhóm: 000x hệ thống · 001x domain/authoring · 002x codegen/Velocitas · 003x product/cross-cutting · 004x mở rộng. Không dùng lại số.
2. Copy `TEMPLATE.md` → `ADR-XXXX-<slug>.md`; điền Context (có dữ kiện + link/commit), Decision (PHẢI/KHÔNG ĐƯỢC, đo được), Diagram (mermaid khi có luồng), Alternatives (bảng), Consequences, Implementation (task→milestone), Verification.
3. Thêm vào bảng + cây mermaid trong `analysis/adr/README.md`.
4. ADR mới giữ `Proposed`; không tự coi việc viết ADR là được Accepted. Khi có quyết định chấp thuận: cập nhật Status/ngày; chỉ đồng bộ `docs/adr/` nếu workflow repo đang dùng bản copy đó. `analysis/adr/` hiện là nguồn chính.
5. Không sửa nội dung ADR Accepted — viết ADR mới `Supersedes ADR-YYYY` và đổi status ADR cũ.
6. Sai khác nhỏ khi implement: thêm mục `Notes / Deviations` (ngày, mô tả, bằng chứng).

# ADR-0054: Thanh hành động có trạng thái rõ ràng và UI chỉ giữ phần của toolchain

- **Status:** Proposed
- **Date:** 2026-10-14
- **Level:** L1 Subsystem
- **Deciders:** PO yêu cầu 2026-10-14; agent đề xuất theo uỷ quyền PO 2026-10-06, chờ PO xác nhận
- **Related:** ADR-0008 (dọn Sim), ADR-0053 (Vehicle app); thiết kế [M16](../../docs/design/M16-ux-and-capacity.md) §3.3–3.4

## Context
- **Thanh hành động không thể hiện trạng thái.** `SvActionBar`, `SynCodeButton`, `RunButtons`, `OpenIdeButton`, `ExportButton` đều là `Button variant='ghost'` chỉ có chữ:
  - không icon, không spinner, không phân cấp hành động chính/phụ;
  - "đang bận" chỉ đổi chữ ("SynCode…");
  - lý do bị vô hiệu chỉ có trong `title`;
  - không hiện app (project) đích.

  PO: "không nổi bật, không có hiệu ứng đang load, khó nhận biết nút có bấm được không".
- **Còn module của Sim không dùng cho toolchain:**
  - sidebar: Tables, Files, Knowledge base, Logs;
  - Settings: Billing, Custom tools, MCP tools, API keys, MCP servers, BYOK, Credential sets.

  Chat/home, integrations, skills, upgrade đã được ẩn ở M01 (`lib/sv/hidden-routes.ts`).

## Decision
1. **Một component `SvActionButton` dùng chung:**
   - Props: `icon`, `label`, `state: 'idle' | 'busy' | 'done' | 'error'`, `emphasis: 'primary' | 'default'`, `disabledReason?`.
   - Khi busy: spinner thay icon, có `aria-busy`, không nhận bấm lặp.
   - `done`/`error`: hiện dấu ✓/✕ 3 giây (đồng hồ inject được để test).
   - Giữ `data-sv-action` để E2E tìm nút.
2. **Bố cục theo quy trình:** Verify, Simulate │ SynCode, Run, Stop │ Open IDE, Export.
   - **Một** nút primary: SynCode khi chưa có bản build ứng với graph hiện tại, Run khi đã có và chưa chạy, Stop khi đang chạy.
   - Bên phải: **chip app đích** (tên, ngôn ngữ, VSS, menu đổi app / "Tạo app", ADR-0053) và **pill trạng thái** (Verified / Simulating / Building bước k/n / Running mm:ss / lỗi cuối).
   - Bấm pill mở Build log, Problems hoặc Run console tương ứng.
3. **Lý do vô hiệu hiện thành dòng gợi ý** ngắn dưới thanh, khi có (vd. "Chưa có app: bấm SynCode để tạo"); tooltip vẫn giữ.
4. **UI tập trung:**
   - Thêm `tables`, `files`, `knowledge`, `logs` vào `HIDDEN_WORKSPACE_SECTIONS` (redirect về `/w`) và bỏ khỏi sidebar.
   - Settings chỉ còn General, Teammates/Organization, Secrets, Recently deleted, Admin, gom trong **một** danh sách cho phép (`SV_SETTINGS_SECTIONS`); section khác redirect về General.
   - Chỉ ẩn bằng cấu hình, không xoá file Sim (ADR-0008: xoá thật để cho đợt dọn sau, khi E2E đã chứng minh không còn ai dùng).
5. Đổi nhãn sidebar "Vehicle projects" thành "Vehicle apps" (ADR-0053). Route giữ `/vehicle-projects` để không gãy link.

## Alternatives considered
| Phương án | Ưu | Nhược | Vì sao loại |
|---|---|---|---|
| Chỉ thêm spinner vào nút hiện có | Nhanh | Vẫn không có phân cấp, không thấy app đích/trạng thái tổng | Không giải quyết "khó nhận biết" |
| Wizard từng bước thay thanh hành động | Rõ cho người mới | Chậm cho người quen; trùng Problems/Build log | Thanh + pill trạng thái đủ |
| Xoá hẳn code Tables/Files/KB/Logs | Diff sạch | Hàng nghìn file, rủi ro gãy import của Sim | Ẩn trước, xoá ở đợt dọn |

## Consequences
- **Tích cực:** trạng thái nhìn là thấy; người dùng tập trung vào toolchain.
- **Tiêu cực:**
  - Thêm một component và một hook trạng thái tổng hợp.
  - Snapshot/E2E dựa trên chữ nút cần cập nhật (E2E chủ yếu dùng `data-sv-action`).
- **Module bị ảnh hưởng:** studio (editor `components/sv`, sidebar, settings navigation, `hidden-routes.ts`).

## Implementation
| Task | Module | Milestone |
|---|---|---|
| `SvActionButton` + hook trạng thái + bố cục thanh + chip app + pill | studio | M16-T06 |
| Ẩn module/Settings + đổi nhãn sidebar | studio | M16-T07 |

## Verification
- **Vitest:**
  - `SvActionButton` qua đủ các state;
  - chọn đúng hành động primary theo (có app? có build mới? đang chạy?);
  - `hidden-routes` cho tables/files/knowledge/logs;
  - danh sách Settings.
- **E2E:**
  - SynCode hiện spinner rồi ✓;
  - sidebar không còn mục ẩn;
  - mở `/workspace/<id>/tables` thì về `/w`;
  - toàn bộ spec cũ xanh.

# ADR-0072: Giao diện hai ngôn ngữ VI/EN, chọn ở Settings, không trộn ngôn ngữ

- **Status:** Accepted — PO yêu cầu và chọn phạm vi 2026-11-01; thực hiện xong M29 2026-11-02
- **Date:** 2026-11-01
- **Level:** L1 Subsystem
- **Deciders:** PO, agent
- **Related:**
  - ADR-0068 (miền Robot trong studio), ADR-0071 (video trung thực);
  - repo dog ADR-0022 (Robot Zoo VI/EN);
  - phase [M29](../phases/M29-ui-language-vi-en.md).

## Context

PO thấy cả hai GUI đang trộn tiếng Việt và tiếng Anh:
- studio SimVehicleApp: khung Sim và phần xe bằng tiếng Anh, miền Robot (thanh Robot, panel, block `rf_*`) bằng tiếng Việt;
- Robot Zoo (repo dog): phần lớn tiếng Việt, xen nhãn tiếng Anh.

PO yêu cầu:
- có chỗ setting ngôn ngữ;
- mỗi chế độ hiển thị rõ ràng một ngôn ngữ.

**Phạm vi PO chọn (2026-11-01):** dịch mọi màn hình trên hành trình người dùng.
- Gồm: đăng ký và đăng nhập, sidebar, workspace, editor workflow, toolbar, panel, block, dock, Vehicle apps, System status, Settings > General, toàn bộ phần SimVehicleApp, xe và Robot.
- Trang Sim ít dùng (billing, marketplace integrations, admin…) giữ tiếng Anh.

Studio fork Sim v0.7.13 chưa có thư viện i18n.

## Decision

1. **Hai ngôn ngữ `en` (mặc định) và `vi`.**
   - Chuỗi hiển thị trên hành trình PHẢI lấy từ từ điển.
   - Từ điển `vi` PHẢI có đủ mọi khoá của `en`; TypeScript kiểm lúc build, test kiểm lúc chạy.
   - Ở chế độ `en`, chuỗi giữ nguyên như hiện tại, nên các E2E tiếng Anh không đổi.
2. **Studio dùng module tự viết `lib/sv/i18n`, không thêm dependency:**
   - `useT()` / `t(key, vars)`;
   - store Zustand `stores/sv/locale`;
   - lưu lựa chọn ở cookie `sv-locale` (đọc được trước khi đăng nhập, đặt `<html lang>`).
3. **Chỗ chọn ngôn ngữ:**
   - Settings > General > Preferences > **Language / Ngôn ngữ**;
   - nút chuyển nhanh trên trang đăng nhập và đăng ký.
4. **Nội dung có sẵn hai ngôn ngữ từ nguồn được dùng đúng ngôn ngữ:**
   - Block robot: `registry.json` đã có `title.vi/en`.
   - Block xe: tên, mô tả, tiêu đề trường lấy theo khoá `block.<type>.*`.
   - Tên instance của block (`Wait 1`) là dữ liệu người dùng, đặt theo ngôn ngữ lúc tạo, KHÔNG dịch lại về sau.
5. **Chẩn đoán từ compiler (`RF*`, mã của compiler xe):** UI hiển thị câu theo mã từ từ điển `diag.<CODE>`. Nếu thiếu khoá thì hiện nguyên văn của compiler. Mã chẩn đoán không đổi (luật cứng #8).
6. **Robot Zoo:** dùng chung quy ước. Nút *Robot Zoo* trong studio mở `…?lang=<locale>` để hai GUI cùng ngôn ngữ; Robot Zoo cũng có nút chuyển riêng. Robot Zoo vẫn chạy độc lập: tham số chỉ là gợi ý, không phải phụ thuộc code.
7. **Không dịch:** log kỹ thuật, path tín hiệu (VSS/RSS), mã lỗi, id, tên trong code sinh ra.

## Alternatives considered

| Phương án | Ưu | Nhược | Vì sao loại |
|---|---|---|---|
| `next-intl` / `i18next` | Chuẩn, có plural, ICU | Dependency mới (license, pin), cấu trúc route theo locale đụng nhiều file Sim | Nhu cầu chỉ là từ điển phẳng + biến; module tự viết dưới 100 dòng |
| Lưu ngôn ngữ trong bảng settings của user | Theo tài khoản | Cần migration và contract; chưa đăng nhập thì không có | Cookie đủ cho máy cá nhân; có thể nâng cấp sau |
| Dịch toàn bộ studio | Không còn tiếng Anh | Hàng nghìn chuỗi upstream, khó đồng bộ Sim | PO chọn phạm vi hành trình |

## Consequences

- **Tích cực:**
  - Mỗi chế độ một ngôn ngữ trên toàn bộ luồng xe và robot;
  - E2E tiếng Anh giữ nguyên.
- **Tiêu cực:**
  - Nhiều file upstream bị đụng (khai báo trong `UPSTREAM_SYNC.allow`);
  - trang Sim ngoài hành trình vẫn tiếng Anh ở chế độ VI;
  - chẩn đoán có tham số động có thể mất chi tiết ở chế độ VI.

## Implementation

| Task | Module | Milestone |
|---|---|---|
| Hạ tầng i18n + Settings + toggle đăng nhập | studio | M29 |
| Bề mặt SimVehicleApp (xe, robot), block xe và robot, chẩn đoán | studio | M29 |
| Khung Sim trên hành trình | studio | M29 |
| Robot Zoo VI/EN | repo dog (ADR-0022) | M29 / dog R4 W7 |
| E2E + video hồi quy (EN) + video hướng dẫn (VI) | e2e, robotics | M29 |

## Verification

- **Test từ điển:** `vi` đủ khoá, không thừa; mọi khoá được dùng đều tồn tại.
- **Test quét chuỗi:** không còn chuỗi tiếng Việt cứng trong component.
- **E2E xe hiện có:** PASS ở `en`.
- **Full flow robot:** PASS ở `en` và `vi`.
- **Video:** hồi quy xe và robot (EN); hướng dẫn dog cho người dùng mới (VI).

## Notes / Deviations

- **2026-11-01 — PO: tên block mặc định luôn là tiếng Anh**, ở cả hai chế độ ngôn ngữ (ví dụ `Wait 1`, `Read Speed`, `Bow 1`).
  - Người dùng được đổi tên tự do, kể cả sang tiếng Việt, vì tên block là dữ liệu của họ.
  - Nhãn toolbar, mô tả, tiêu đề field và dòng tóm tắt vẫn theo ngôn ngữ đang chọn.
  - Lớp dịch DOM không dịch tên block trên canvas.
- **2026-11-01 — Cách dịch thực tế:**
  - Component mới (miền Robot) dùng khoá từ điển `useSvT()` / `svT()`.
  - Block, component xe có sẵn và khung Sim dùng một bảng câu EN→VI (`lib/sv/i18n/phrases-vi.ts`), áp ở hai chỗ:
    1. khi nạp registry block, cho mô tả, tiêu đề field, nhãn lựa chọn và placeholder;
    2. trên DOM bằng MutationObserver, chỉ ở chế độ VI, bỏ qua input, editor code, tên block trên canvas và nội dung người dùng.
  - Lý do: tránh sửa hàng trăm file upstream của Sim, và chế độ EN giữ nguyên từng byte.
  - Kiểm chứng bằng quét trình duyệt ở chế độ VI.
- **2026-11-02 — Kết quả và giới hạn đã đo:** xem [báo cáo M29](../../docs/reports/M29.md).
  - Tên tín hiệu (VSS/RSS) là định danh, được đánh dấu không dịch.
  - Nhãn cổng (then/else/error…) chỉ dịch trên block, không dịch như văn bản tự do (mức log giữ nguyên).
  - Cả hai GUI khai báo `translate="no"`: trình duyệt không dịch chồng.

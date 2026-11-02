# M29 — Miền Robot dùng chung khung xe + giao diện VI/EN + video

**ADR:** ADR-0072 (VI/EN), ADR-0068 Notes 2026-11-01 (khung chung), repo dog ADR-0022.

**Yêu cầu PO 2026-11-01:**
- có chỗ chọn ngôn ngữ ở cả hai GUI, mỗi chế độ một ngôn ngữ rõ ràng;
- test lại full luồng xe rồi full luồng robot;
- quay video hồi quy;
- quay video hướng dẫn chi tiết bằng tiếng Việt cho người dùng mới (dog simulation), từ tạo project → chạy → xem log → robot làm theo workflow.

| Task | Nội dung | Gate |
|---|---|---|
| T01 | Miền Robot dùng `SvActionBar` / `SvBottomDock` (Problems · Live) / dòng tóm tắt block / nhãn field đúng | Vitest + full flow robot PASS |
| T02 | Panel tín hiệu RSS (cây, tìm, kéo thả) như Vehicle panel | Vitest + E2E |
| T03 | Hạ tầng i18n studio (`lib/sv/i18n`, cookie `sv-locale`, Settings > Language, toggle trang đăng nhập) | Test từ điển đủ khoá |
| T04 | Dịch bề mặt SimVehicleApp + block xe/robot + chẩn đoán | Không còn chuỗi VI cứng; EN không đổi |
| T05 | Dịch khung Sim trên hành trình (auth, sidebar, panel, toolbar, editor, settings general) | Quét chế độ VI |
| T06 | Robot Zoo VI/EN (repo dog, ADR-0022) | Test cặp câu + quét trình duyệt |
| T07 | E2E xe đầy đủ + full flow robot ở EN và VI | PASS |
| T08 | Video hồi quy xe (EN) + robot (EN) | Manifest + kiểm |
| T09 | Video hướng dẫn dog cho người dùng mới (VI) + user guide | Manifest + xem từng chặng |
| T10 | Báo cáo M29, ROADMAP, commit hai repo | — |

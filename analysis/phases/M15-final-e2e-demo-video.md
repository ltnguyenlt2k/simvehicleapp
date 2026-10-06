# M15 — E2E toàn diện (Playwright) + video demo full luồng trong README

**Mục tiêu:** sau khi **toàn bộ** plan, ADR và ROADMAP đã hoàn tất (M0–M14 có gate PASS, ADR liên quan Accepted, ROADMAP không còn mục mở), chạy một bộ E2E Playwright rộng — rất nhiều trường hợp kéo thả và các luồng đầy đủ — rồi quay **một video full luồng chính xác, chuẩn chỉ** và đưa vào [README.md](../../README.md) tổng.
**ADR:** không có quyết định kiến trúc mới; nếu chọn lưu video bằng Git LFS hoặc cần cấu hình CI mới ⇒ viết ADR trước (skill `adr-writing`).
**Phụ thuộc:** M0–M14 (yêu cầu PO 2026-10-06: đây là bước **cuối cùng** của plan).
**Nguyên tắc:** test chạy trên stack tách biệt (`docker compose -p sv-e2e …`, cổng riêng, secret ngẫu nhiên) — không bao giờ đụng dữ liệu stack dev; mọi dữ liệu test tất định (seed, user/email theo run).

## Tasks
| ID | Task | Module | Test / bằng chứng |
|---|---|---|---|
| M15-T01 | Lập ma trận kịch bản E2E (`e2e/SCENARIOS.md`): mỗi hàng = luồng + tiêu chí PASS, truy ngược tới FR/ADR | studio/e2e | review PO |
| M15-T02 | **Kéo thả — toolbar:** mỗi block `sv_*` + Loop/Parallel kéo vào canvas, vào container, ra khỏi container; thả trên canvas rỗng (overlay) và canvas có sẵn block; thả bị từ chối (workflow khoá, quyền viewer) | studio/e2e | Playwright, mỗi block ≥ 1 ca |
| M15-T03 | **Kéo thả — panel Vehicle:** sensor/actuator/attribute/array cho mỗi release (v4.0, v4.2): menu đúng kind (sensor không Set, array không Set), tên block tự đặt, path khoá; click/keyboard thay cho kéo | studio/e2e | Playwright, bảng kind × release |
| M15-T04 | **Nối & chỉnh:** nối mọi loại handle (`then/else`, `case-<i>`, `ok/timeout`, `stable/broken`, container start/end), nối sai bị chặn (vòng, handle lạ), xoá/undo/redo, copy/paste, đổi tên block ⇒ tham chiếu `<…>` cập nhật, editor biểu thức/thời lượng/giá trị theo kiểu | studio/e2e | Playwright |
| M15-T05 | **7 golden workflow dựng hoàn toàn bằng UI** (GW-A…G) ⇒ Problems sạch ⇒ graph adapter khớp `graph.json` golden | studio/e2e | Playwright + so graph |
| M15-T06 | **Full luồng end-to-end:** signup → tạo workflow → dựng GW-A bằng kéo thả → lint sạch → Simulate (timeline khớp scenario) → SynCode → build → Run (databroker + mock) → Signals panel inject Speed → Hazard bật trên trace → Open IDE → Export zip → AI đề xuất patch (provider giả lập) → restart stack ⇒ mọi thứ còn nguyên | toàn hệ | Playwright full-stack |
| M15-T07 | **Cộng tác & bền vững:** 2–3 phiên realtime cùng kéo thả, xung đột chỉnh sửa, mất kết nối realtime/catalog/compiler (UI báo đúng, không mất dữ liệu), restart từng service | studio/e2e | Playwright |
| M15-T08 | Ổn định: chạy toàn bộ bộ test **3 lần liên tiếp không flaky** trên CI (shard nếu cần) và local; mọi flake phải có root cause, không tăng retry để che | CI | 3 run xanh liên tiếp |
| M15-T09 | **Kịch bản quay video** (`e2e/demo/full-flow.demo.ts`): Playwright `recordVideo` 1920×1080, nhịp chậm có chủ đích, chú thích từng bước (overlay), dữ liệu tất định; quay = chạy lại được bằng 1 lệnh (`scripts/sv demo-video`) | studio/e2e | video sinh lại được, cùng nội dung |
| M15-T10 | Hậu kỳ tối thiểu & kiểm chất lượng video: cắt khoảng chờ, mp4 (H.264) + ảnh GIF/poster ngắn; xem lại toàn bộ: không lỗi UI, không dữ liệu giả gây hiểu lầm, không secret/email thật trên màn hình | docs | checklist xem video ký bởi PO |
| M15-T11 | Đưa video vào [README.md](../../README.md) tổng: mục "Demo" (poster/GIF bấm vào xem mp4 + mô tả từng chặng + lệnh tái tạo); **kiểm tra hiển thị thật trên GitHub** trước khi đóng (verify cách GitHub hiển thị video: tệp trong repo, release asset hay attachment — chọn cách hiển thị được, giới hạn dung lượng) | root | ảnh chụp README trên GitHub |
| M15-T12 | Báo cáo `docs/reports/M15.md` + cập nhật ROADMAP | — | report |

## DoD
- `e2e/SCENARIOS.md` phủ: mọi block, mọi kind VSS × release, mọi handle, 7 golden, full luồng, cộng tác, lỗi service.
- Toàn bộ E2E xanh 3 lần liên tiếp trên CI, không ca bị skip/quarantine.
- Video full luồng tái tạo được bằng `scripts/sv demo-video`, xem lại đạt checklist, hiển thị được trong README trên GitHub.

## Acceptance Gate
3 run CI xanh liên tiếp của toàn bộ E2E; video full luồng (≥ toàn bộ chặng M15-T06) có trong README và PO xác nhận đã xem.

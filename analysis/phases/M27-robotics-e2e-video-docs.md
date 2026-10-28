# M27: Robotics — E2E `@live` full luồng, video, tài liệu, baseline v0.1

> **Yêu cầu:** PO 2026-10-27, mục tiêu cuối: kéo thả kịch bản ⇒ tín hiệu RSS ⇒ Protobus ⇒ ROS 2 ⇒ robot làm đúng.
> **Thiết kế:** [design](../../docs/design/M22-robotics-extension.md) §7, §10.
> **ADR:** 0064–0068 — Proposed, chờ PO xác nhận.
>
> **Phụ thuộc:** gate M24 và M26 PASS.
>
> **Nguyên tắc:** tương đương AGENTS §4 bước 7 cho stack robot (ADR-0068 §9):
> - `@live` với workflow phức tạp;
> - video nhịp người dùng;
> - README + user guide.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | Playwright mock E2E đầy đủ trên CI: tạo từ trống ⇒ kéo thả RW-B ⇒ lint ⇒ Simulate ⇒ Test ⇒ Export | robotics/e2e | — | PASS trên CI |
| T02 | Playwright `@live` trên dog sim: kéo thả RW-B (pilot) + RW-A (chào) từ đầu ⇒ Run ⇒ robot đi/chào thật (kiểm qua RSS + log dog) ⇒ STOP ⇒ Export; thêm `@live-restart` (bridge restart giữa run) | robotics/e2e | T01 | PASS ×3 liên tiếp local |
| T03 | `sr demo-video`: nhịp người dùng (con trỏ thấy được, gõ chữ), chia màn hình Robot Studio + Robot Zoo; helper viết mới trong `robotics/e2e` | robotics/e2e, scripts | T02 | `robotics/docs/media/*.mp4` + GIF |
| T04 | README chính (mục Robotics trỏ sang `robotics/README.md`), `robotics/README.md`, `docs/user-guide/robotics/` (cài, chạy dog, tạo kịch bản, Simulate/Test/Run, an toàn) | docs | T03 | Tài liệu khớp UI và lệnh hiện tại |
| T05 | Soak 30 phút RW-B trên dog sim; đo RAM/CPU toàn bộ; checklist an toàn | all | T02 | Bảng số đo; không rò bộ nhớ |
| T06 | Baseline `robotics-v0.1` (tag local, CHANGELOG), `docs/reports/M27.md`, ROADMAP | all | T01–T05 | Gate PASS |

## Acceptance gate
1. `@live` full luồng PASS ×3.
2. Video mới theo UI hiện tại.
3. README + user guide cập nhật.
4. Soak 30 phút PASS.
5. ADR 0064–0068 đã Accepted.

## Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Quay video cần dog + sr trên máy 11 GB | Dog không RViz; một stack; đo trước ở M24-T06 |
| `@live` không chạy được trên CI (repo dog private) | Chạy local, ghi bằng chứng; chờ PO quyết RR6 |

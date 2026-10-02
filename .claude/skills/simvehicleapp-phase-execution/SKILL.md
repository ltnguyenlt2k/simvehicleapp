---
name: simvehicleapp-phase-execution
description: Use when starting, executing, or finishing a SimVehicleApp milestone (M0–M14) or a task ID like M06-T14 — enforces reading order, ADR prerequisites, acceptance gates, and the completion report.
---

# Thực thi milestone / task SimVehicleApp

## Trước khi bắt đầu
1. Mở `docs/ROADMAP.md` → xem trạng thái feature/milestone hiện tại (nguồn tracking duy nhất, luôn mới nhất). Milestone trước chưa `✔` đủ ⇒ DỪNG, báo lại — không bắt đầu milestone phụ thuộc.
2. Mở `analysis/13-implementation-roadmap.md` → xác định milestone và **phụ thuộc** (đồ thị §1). Kiểm tra report `docs/reports/M<dep>.md` có `Acceptance gate: PASS`. Nếu không ⇒ DỪNG, báo lại.
3. Mở `analysis/phases/M<nn>-*.md`. Kiểm tra cột "ADR phải Accepted" trong roadmap §2; ADR còn Proposed ⇒ đề xuất review/spike trước.
4. Đọc ADR liên quan + `CONTRACT.md` + `AGENTS.md` của repo con sẽ sửa.
5. Trong `docs/ROADMAP.md`, đổi dòng feature sẽ làm từ `☐` sang `🔄` + ghi người/agent + ngày bắt đầu.

## Khi làm task
- Một task = một branch `feat/M<nn>-T<nn>-<slug>` trong repo con; commit nhỏ, message có task ID.
- Vòng lặp viết code trong task: skill `implementation-loop` (review doc → research → implement → mismatch → đồng bộ doc → test → sửa lỗi → checklist production-ready).
- Test trước khi có thể: golden/contract/conformance đã định nghĩa trong phase file.
- Không mở rộng scope ngoài task; phát hiện thiếu ⇒ ghi "Follow-up" vào report, không tự làm.
- Tài liệu lệch source thật ⇒ ưu tiên source thật, ghi `Notes / Deviations` trong ADR (skill `adr-writing`).

## Khi xong 1 feature (trong lúc làm, không chỉ cuối milestone)
Đổi dòng feature đó trong `docs/ROADMAP.md` từ `🔄` sang `✔` + ghi bằng chứng (commit SHA ngắn/PR/test output) + ngày. Không tick khi chưa có test thật pass (xem skill `implementation-loop`).

## Kết thúc milestone
1. Chạy toàn bộ test của các module đã chạm + `scripts/smoke.sh` (từ M7 trở đi).
2. Kiểm từng tiêu chí trong mục **Gate** của phase file, thu bằng chứng (lệnh + output rút gọn, số liệu).
3. Viết `docs/reports/M<nn>.md` theo `analysis/phases/REPORT_TEMPLATE.md`; ghi `Acceptance gate: PASS` chỉ khi mọi tiêu chí PASS. Test fail ⇒ ghi FAIL kèm output, không làm mờ.
4. Bump `simvehicleapp.lock.yaml` cho các module đã release (skill `multi-repo-modules`).
5. Cập nhật dòng tổng quan milestone trong `docs/ROADMAP.md` §3 (trạng thái tổng + tiến độ x/y).

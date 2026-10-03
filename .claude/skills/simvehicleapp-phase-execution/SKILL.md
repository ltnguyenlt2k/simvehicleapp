---
name: simvehicleapp-phase-execution
description: Use when starting, executing, or finishing a SimVehicleApp milestone (M0-M14), a task ID like M06-T14, or any real implementation code for this project after its ADR is Accepted — enforces reading order, ADR prerequisites, the research-test-implement-mismatch loop, acceptance gates, and tracking in docs/ROADMAP.md.
---

# Thực thi milestone/task & vòng lặp code SimVehicleApp

> Không lặp lại luật cứng `AGENTS.md` §2 (đã luôn có trong context) — chỉ trích số luật khi áp dụng.

## Trước khi bắt đầu 1 task
1. `docs/ROADMAP.md` → trạng thái feature hiện tại (tracking duy nhất). Milestone phụ thuộc chưa `✔` đủ (xem `docs/reports/M<dep>.md` có `Acceptance gate: PASS`) ⇒ DỪNG, báo lại — không bắt đầu milestone phụ thuộc.
2. `analysis/phases/M<nn>-*.md` → task cụ thể + cột "ADR phải Accepted" (`analysis/13-implementation-roadmap.md` §2); ADR còn Proposed ⇒ đề xuất review/spike trước khi code.
3. Đọc ADR liên quan (phần *Decision*) + `CONTRACT.md`/BlockSpec + `AGENTS.md` của repo con sẽ sửa. Không code từ trí nhớ/giả định.
4. Đổi dòng feature trong `docs/ROADMAP.md`: `☐`→`🔄` + người/agent + ngày bắt đầu.

## Vòng lặp trong 1 task (đủ bước, đúng thứ tự)
1. Research upstream nếu đụng API/version/behavior (Sim/Velocitas/KUKSA/VSS/code-server/MCP) → skill `upstream-verify`.
2. Viết test trước (unit; + golden/contract/conformance nếu đụng IR/execution — skill `golden-and-parity-tests`).
3. Implement tối thiểu để test pass. Một task = một branch `feat/M<nn>-T<nn>-<slug>`, commit nhỏ có task ID.
4. **Mismatch** (ADR nói A, source/test cho thấy B) → DỪNG, không âm thầm lệch: ghi bằng chứng cụ thể (file/dòng, commit, output lệnh) + ≥1 phương án; xử lý theo skill `adr-writing` (Proposed → sửa trực tiếp; Accepted → "Notes/Deviations" hoặc ADR mới `Supersedes`). Đổi Decision cốt lõi của ADR Accepted hoặc luật cứng §2 ⇒ hỏi user trước khi tiếp tục; chi tiết implementation (tên hàm, cấu trúc nội bộ) ⇒ tự quyết, ghi lại lý do. Cập nhật xong doc rồi mới quay lại code — doc không bao giờ lạc hậu hơn code đã merge.
5. Test toàn diện, không giả định "sẽ pass": unit + contract + golden/parity + build thật của đúng module; `docker compose -f modules/<m>/compose.yaml config -q` nếu đụng compose.
6. Lỗi → sửa root cause (không suppress, không nới dung sai test). Lộ thêm gap doc → quay lại bước 4.

## Trước khi tick `✔` (chỉ phần KHÔNG có sẵn trong AGENTS.md §2)
- Determinism (luật #5): test chạy 2 lần so byte; biên dữ liệu null/empty/mảng rỗng/overflow int64-uint64 (string-encode, ADR-0018)/ngoài `allowed`/`min`/`max`/timeout.
- Error path có test riêng, không chỉ happy path; không còn TODO/stub che một đường chạy thật.
- Đổi bề mặt API/contract ⇒ đã có ADR + bump version + test đồng bộ (`block-parity.test.ts` hoặc contract test).
- Không vi phạm luật #2 (import chéo module), #4 (Scratch/`ee/`, skill `license-compliance`), #8 (đổi tên mã diagnostic).

Chỉ đổi `docs/ROADMAP.md`: `🔄`→`✔` + bằng chứng (commit/PR/test output) + ngày, **sau khi** bước 5 đã pass thật — không tick khi "nghĩ là xong".

## Kết thúc milestone
1. Test toàn bộ module đã chạm + `scripts/sv smoke` (từ M7 trở đi).
2. Kiểm từng tiêu chí **Gate** của phase file, thu bằng chứng (lệnh + output rút gọn, số liệu).
3. Viết `docs/reports/M<nn>.md` theo `analysis/phases/REPORT_TEMPLATE.md`; `Acceptance gate: PASS` chỉ khi mọi tiêu chí PASS — fail thì ghi FAIL kèm output, không làm mờ.
4. Bump `simvehicleapp.lock.yaml` cho module đã release (skill `multi-repo-modules`).
5. Cập nhật dòng tổng quan milestone trong `docs/ROADMAP.md` §3.

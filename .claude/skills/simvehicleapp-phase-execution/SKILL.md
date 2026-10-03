---
name: simvehicleapp-phase-execution
description: Start, implement or finish a SimVehicleApp milestone or numbered task; enforce ADR prerequisites, scoped research and tests, acceptance gates, and ROADMAP tracking.
---

# Thực thi milestone, task và code

Không lặp luật cứng trong `AGENTS.md`. Đọc đúng phần cần thiết, tái dùng context và bằng chứng chưa đổi.

## Bắt đầu

1. Đọc feature trong `docs/ROADMAP.md`, task trong `analysis/phases/M<nn>-*.md`, dependency trong `analysis/13-implementation-roadmap.md`, rồi Decision/Status của ADR liên quan, instruction local và contract/spec thật của module.
2. Dependency phải có gate PASS theo tiêu chí hiện hành. Ưu tiên `docs/reports/M<dep>.md`; nếu chưa có, đối chiếu phase và report được dẫn tới. Spike PASS không đồng nghĩa milestone PASS. Gate FAIL/thiếu bằng chứng hoặc ADR bắt buộc còn Proposed ⇒ không implement phần phụ thuộc; nêu chính xác phần thiếu và tiếp tục phần độc lập được phép.
3. Khi bắt đầu làm thật, đổi feature `☐`→`🔄` trong `docs/ROADMAP.md`, ghi người/agent và ngày. Không tick chỉ vì đang phân tích.
4. Dev hiện theo ADR-0009: một repo, nhiều module folder. Branch `feat/M<nn>-T<nn>-<slug>` khi cần; không tự đổi branch nếu working tree có thay đổi. Submodule/lock chỉ dùng ở release.

## Vòng implement

1. Chỉ tải skill domain áp dụng. Đụng API/version/behavior upstream thì dùng `upstream-verify`: bằng chứng local đúng pin trước, tải source còn thiếu sau.
2. Viết regression test trước khi có thể; thêm golden/contract/conformance khi IR hoặc execution semantics thay đổi.
3. Implement tối thiểu trong module sở hữu, không mở refactor ngoài task.
4. Source/test lệch ADR hoặc tài liệu: ghi bằng chứng. Chi tiết nội bộ tự giải quyết và đồng bộ doc; thay đổi contract/kiến trúc dùng `adr-writing`. Không tự đổi luật cứng hay Decision cốt lõi của ADR Accepted.
5. Chạy test module và contract test liên quan, type-check/lint, rồi build thật nếu có code build thay đổi. IR/codegen/runtime đổi thì chạy golden/conformance/parity phù hợp; compose đổi thì validate fragment độc lập và root. Không chạy lại check đã PASS nếu input không đổi và không có nghi ngờ cụ thể.
6. Sửa root cause. Không suppress lỗi, nới test hoặc đánh PASS khi check chưa chạy.

Không gọi LLM/API trả phí, eval live hay agent phụ mặc định. Chỉ dùng khi task yêu cầu và đã được phép.

## Hoàn tất

Trước khi tick `✔`, kiểm diff và các biên liên quan: error path, null/empty, timeout/race; determinism hai lần khi chạm IR/file sinh; int64/uint64 là decimal string trong JSON; diagnostic công khai chỉ thêm. Contract/API đổi phải có ADR, version và test đồng bộ. Không để TODO/stub che đường chạy thật.

Cập nhật `docs/ROADMAP.md` từ `🔄`→`✔` chỉ sau khi check bắt buộc PASS; ghi commit/PR/report hoặc lệnh và kết quả cùng ngày. Cập nhật DoD của phase đúng bằng chứng.

Kết thúc milestone: chạy toàn test module đã chạm và mọi acceptance gate; smoke theo phase (`scripts/sv smoke` không tự thay cho E2E M7+). Viết `docs/reports/M<nn>.md` theo template và chỉ ghi `Acceptance gate: PASS` khi tất cả tiêu chí PASS. Cập nhật tổng quan milestone trong ROADMAP. Release mới bump lock nếu workflow/script thực đã tồn tại.

M0 hiện còn contracts/fixtures T05–T06 và CI T08 theo ROADMAP. Đọc trạng thái hiện tại trước khi làm; không suy ra hoàn tất từ README hoặc spike report.

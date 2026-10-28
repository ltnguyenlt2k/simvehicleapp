# M26: Robot Studio — web kéo thả, API, runner, Simulate/Test/Run

> **Yêu cầu:** PO 2026-10-27 — "mục tiêu cuối cùng là tôi có thể kéo thả workflow tạo một kịch bản…"; PO 2026-10-28 — viết mới, không dùng studio hiện có.
> **Thiết kế:** [design](../../docs/design/M22-robotics-extension.md) §7, §8.
> **ADR:** [0068](../adr/ADR-0068-robot-studio-run-and-scenarios.md) — Proposed, chờ PO xác nhận.
>
> **Phụ thuộc:** gate M25 PASS. Task Run live cần gate M24 PASS.
>
> **Nguyên tắc:**
> - kiểm UI trên image build từ CI, không chạy dev server nặng trên máy 11 GB;
> - STOP độc lập với app.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | Spike S-R5 (React Flow 200 node, node tuỳ biến, build trong container) và S-R6 (runner: process con, uid, rlimit, network internal); ghim bản thư viện web/API | studio, runner | — | Số đo theo design §9 |
| T02 | studio-api: project trên volume, gọi rflowc, điều phối runner, WS live/trace/log | studio | T01 | Unit + contract test |
| T03 | rflowc service: `/lint`, `/build`, `/blocks`, `/rss/catalog` | robotflow | — | Test HTTP; build trả file set, không ghi đĩa |
| T04 | runner: chạy file set, một run mỗi robot, SIGTERM ⇒ SIGKILL 3 s, event stdin, trace stdout | runner | T01 | Fault test S-R6; run thứ hai bị từ chối |
| T05 | Web: Projects + Editor (palette từ `/blocks`, cây RSS, canvas, props có kiểu, diagnostics debounce) | studio | T02, T03 | Vitest; E2E mock kéo thả từng block |
| T06 | Simulate: live, Flow trace tô node, nút sự kiện, bản đồ 2D, log | studio | T04, T05 | E2E mock |
| T07 | Test: `scenario.v1` (contracts), trình soạn timeline, kỳ vọng, `timeScale`, báo cáo PASS/FAIL | studio, contracts | T06 | E2E: kịch bản đúng PASS, sai FAIL |
| T08 | Run: chọn robot, STOP luôn hiện, lease, link Robot Zoo; Export zip | studio | T06 (+ M24) | E2E mock + kiểm tay trên dog sim |
| T09 | Mẫu RW-A..RW-D trong studio (dùng golden M25) | studio | T05 | E2E tạo từ mẫu ⇒ Simulate đúng |
| T10 | Đóng milestone: `docs/reports/M26.md`, ROADMAP | all | T01–T09 | Gate PASS |

## Acceptance gate
1. Vitest + Playwright mock PASS trên CI.
2. STOP và lease có test E2E.
3. Bốn mẫu chạy được Simulate và Test.
4. Run trên dog sim kiểm tay có bằng chứng (`@live` đầy đủ ở M27).

## Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Khối lượng UI lớn (RR7) | Phạm vi v0.1 cố định; không làm AI/đa người dùng |
| Người dùng nhầm Simulate với robot thật | Nhãn chế độ rõ, broker tách biệt |
| Cách ly runner yếu hơn container | Chỉ chạy cục bộ 1 người dùng; network internal; ghi rủi ro |

# M25: RobotFlow — block registry, compiler `rflowc`, IR `rfir.v1`, codegen Python, runtime `rfrt`

> **Yêu cầu:** PO 2026-10-27. "Trình biên dịch riêng… ngôn ngữ dễ trước… runtime kết nối robotic… workflow kéo thả có log, có kịch bản."
> **Thiết kế:** [design](../../docs/design/M22-robotics-extension.md) §6, §7 (mẫu RW-A..D).
> **ADR:** [0067](../adr/ADR-0067-robotflow-language-compiler-runtime.md) — Accepted for implementation 2026-10-29; gates OPEN.
>
> **Phụ thuộc:** gate M23 PASS (broker sim + mock). Không cần M24, nên chạy song song.
>
> **Nguyên tắc:**
> - không LLM trong đường sinh code;
> - cùng input ⇒ cùng bytes;
> - mã `RF*` chỉ thêm;
> - runtime không import ROS.

M24 integration finding: Subscribe is on-change, not a capture heartbeat.
BusClient must refresh current sensor records with Get when evaluating freshness,
honor quality/source clock/epoch and keep event triggering separate from capture
refresh. Constant healthy modes must not become stale solely because no value
change event arrived. Cover this explicitly in T06/C-R conformance.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | Schema `robotflow.v1`, `rfir.v1`, `block.v1`; dải mã `RF1xxx`…`RF6xxx` trong `diagnostics.v1.json` | contracts | — | Validate fixture đúng/sai |
| T02 | Block registry v0.1 (≈ 25 block, design §6.3): `*.block.yaml` + `semantics` mỗi block | robotflow | T01 | Validate theo `block.v1`; review semantics |
| T03 | Biểu thức: lexer/parser Pratt, literal có đơn vị, kiểm kiểu + chiều đơn vị | robotflow | T01 | Test bảng (≥ 100 ca) gồm lỗi |
| T04 | Compiler S0–S6, mode `lint`/`build`, IR + chuẩn hoá + `irHash` | robotflow | T02, T03 | Test "cố ý sai" mỗi mã; perf 200 node < 300 ms |
| T05 | Codegen Python (`flow.py`, `main.py`, `rflow.lock.json`); golden RW-A..RW-D (IR + source) | robotflow | T04 | Golden ×2 cùng bytes |
| T06 | Runtime `rfrt`: BusClient, behavior engine, Hold, lệnh + timeout, lease, trace, event stdin, tắt máy an toàn; wheel ghim version | rfrt | T01 | Unit test với fake bus nội bộ |
| T07 | Conformance C-R01..C-R12 (ADR-0067 Verification): app sinh ra + `protobus-sim` + mock trong compose CI | robotflow, rfrt | T05, T06 | 12/12 ×2 lần liên tiếp |
| T08 | CLI `sr build <flow.json>` / `sr run --sim|--live`; RW-A..RW-D headless trên dog sim (sau khi M24 xong) | scripts, all | T07 (+ M24 cho live) | Log/trace làm bằng chứng; robot làm đúng |
| T09 | Đóng milestone: `docs/reports/M25.md`, ROADMAP | all | T01–T08 | Gate PASS |

## Acceptance gate
1. Golden RW-A..D tất định ×2.
2. Conformance 12/12 ×2.
3. Mọi mã `RF*` có test.
4. RW-A..D chạy headless đúng hành vi trên mock; và trên dog sim khi M24 đã PASS.

## Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Test thời gian thực bị flaky | So theo thứ tự sự kiện + cửa sổ có dung sai; chạy ×2 trong gate |
| Song song + lệnh dài làm huỷ tác vụ phức tạp | Semantics ghi rõ thứ tự huỷ; conformance cho parallel any/all |
| Lint chậm khi canvas lớn | Perf gate 200 node |


## Amendment 2026-10-29

ADR-0069 is authoritative for integration and review R01–R08. Implementation authorized; no runtime gate has passed yet. M25 compiler/mock gate may proceed after M23; combined live acceptance requires M24. M26 technical gate precedes M27 final UI/video acceptance. CI source artifacts must be available before image gates.

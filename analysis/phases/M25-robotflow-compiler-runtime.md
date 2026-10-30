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

T01 local PASS: ADR-0076 closes graph/block/typed IR wire shapes; additive
RF1001–RF6006 catalog retains all RSS/PB codes. Eight contract groups PASS /0.133 s
in independent pinned Python 3.12 image, offline/read-only/nonroot. Initial red
fixture and final logs retained; deterministic schema source/JSON equality tested.
CI contract/image/lock scan pending. T02–T09 remain OPEN; no runtime or live
workflow acceptance. M23 prerequisite PASS; M24 live local gate complete while
the fresh-zero test-fix candidate CI is pending. See docs/reports/M25-progress.md.

2026-10-31: T01 Robotics CI 41094829674 SUCCESS at 964f636b. T02 local PASS:
24 single-source data-only block records with localized semantics, closed safe
registry loader, immutable canonical snapshots/hash and typed default validation.
All robot outputs/timeouts required. Combined 14 tests PASS /0.870 s, precheck
PASS. Hold explicit overall timeout amendment in ADR-0076; no released artifacts
exist. T02 candidate CI pending. T03 parser/units next; no runtime/UI/video claim.
M24 scoped live technical gate closed with 350f2ca8 CI green and 1800-second soak.

T03 local PASS: 163 expression cases, 19 combined groups /1.055 s, every valid
constant AST schema-validated; 22 RSS regressions /0.481 s and frozen catalog
bytes/hash unchanged. Canonical data-only units.v1 (ADR-0077), checked source
snapshot, signed affine conversion and numeric/grammar/depth boundaries.
Failure retained before decimal normalization fix. Candidate CI pending; T04
compiler diagnostic/flow/safety/performance gates next. Runtime/GUI/video OPEN.

T04 local PASS: every RF code deliberately exercised (31), valid lowering for all
24 blocks, canonical profile/units/IR hashes excluding UI, finite expansion and
structured-region/yield/resource checks. 30 groups /8.869 s PASS; warm 200-node
lint44.816 ms on 2 CPUs/256MiB; RSS22/Protobus112 regressions PASS. ADR-0078 and
checkpoint JSON record boundaries/limits. T04 candidate CI pending; T05 source
codegen/goldens next, no runtime or live workflow acceptance yet.

T05 local PASS (2026-10-31): deterministic native async Python emitter, fixed
10-file application set, immutable normalized source/IR/catalog/profile/units/
registry identities and exact UTF-8 file/source/artifact hashes (ADR-0079).
RW-A..D reviewed golden IR/source files compile twice to identical bytes, including
UI/node/edge order invariance. Generated Python uses native async/if/for/while;
module import does not run the application. Hostile log strings remain data.
Runtime wheel hash is omitted until an actual T06 package exists; live deployment
must reject an absent pin. This is codegen evidence, not runtime execution.

The first complex template run exposed exponential recursive JSON Schema checking:
wrong-opcode alternatives recursively rechecked result branches. Failure log kept
in runtime/m25/codegen-failed-recursive-schema-performance.log. Discriminated
opcode validation now visits only the selected closed variant; loop count/forever
remain exclusive. Negative nested/open-field fixtures plus bounded four-template
regression cover the fix. Final 38 groups PASS /14.726 s in Compose; precheck and
diff whitespace checks PASS. Localized property/enum labels added to single-source
block descriptors for the upcoming UI. T05 candidate CI pending. T06 next;
conformance/live/UI/video remain OPEN.
T04 e6920f58 CI qualified: Robotics41105342036 and general41105342105 SUCCESS.

T05 CI qualified at 2fee1031: Robotics41110002948/general41110003083 SUCCESS.
T06 IN_PROGRESS: independent ROS/compiler-free runtime foundations now verify
the closed artifact set before import, return immutable checked bytes, reject
missing/wrong runtime pins, altered files/semantic identities, symlinks and extra
module paths. Strict JSON rejects duplicate/nonfinite/overflow numbers. Typed
AST execution has 118 explicit wire fixtures and dynamic unit/unknown/overflow
cases. 14 groups PASS /2.735 s; precheck/diff checks PASS. Initial registry hash
interpretation mismatch retained and corrected against its public data contract.
ADR-0080 records identity versus trust and non-coercible unknown semantics.
Unit runtime digest is deliberately synthetic; no actual wheel or application
launch is claimed. BusClient/engine/Hold/lease/trace/event/shutdown/wheel remain
required for T06. T07–T09, GUI and final continuous video remain OPEN.

T06 prerequisite extension local PASS: Protobus protocol candidate 1.4 adds
read-only InspectExecution with catalog/epoch/execution correlation, separate
logical and physical terminal states, current provider session and STOP receipt
identity (ADR-0081). Quarantine cleared by ResetStop does not fabricate an old
physical result. Late matching release is idempotent; conflicting terminal fails.
Actual gRPC tests cover pending/confirmed/late feedback, wrong identity and
post-STOP inspection without authority. RSS22 + broker118 groups /31.113 s PASS;
after CLI addition, CLI6 /UNRECORDED s and protocol5 /0.001 s PASS (actual duration in
runtime logs authoritative). precheck/diff PASS. Production live remains the
previous qualified 1.3 image; no unqualified recreation or motion performed.
Mandatory target mapping/source/context metadata, normal Dog Cancel and freshness
qualification remain unresolved before live runtime acceptance. T06 still OPEN;
no full runtime, conformance, GUI or video completion claim.

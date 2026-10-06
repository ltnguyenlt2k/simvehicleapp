# ADR-0014: Canonical IR v1 (control graph + expression trees, hashed, versioned)

- **Status:** Proposed — triển khai M4 theo uỷ quyền PO 2026-10-06, **chờ PO chấp thuận** khi verify cuối · **Date:** 2026-09-30 · **Level:** L1
- **Related:** FR-WF-03, NFR-01; Master Plan Part 6; [06 §2](../06-ir-and-compiler.md#2-ir-v1--cấu-trúc)

## Context
Master Plan 6.2 đề xuất IR có `nodes` + `edges(kind: data|control)` và `metadata.generatedAt`. Phân tích thêm:
- `generatedAt` trong IR phá tính tất định của `irHash`.
- Data edges tách rời khiến backend phải tự dựng lại biểu thức; mô hình tham chiếu (ADR-0013) cho phép biểu diễn data bằng **cây biểu thức** gọn hơn.
- Backend cần biết trước danh sách signal/topic/state để sinh khai báo & AppManifest.

## Decision
1. IR v1 gồm: header (`irVersion, compilerVersion, workflowId, workflowRevision, name, modelHash, sourceGraphHash, irHash`), `signals[]`, `topics[]`, `state[]`, `triggers[]` (có `entry`, `concurrency`), `nodes[]` (có `opcode`, `args` là expression tree, `next` theo handle, `body` cho container, `src`).
2. **Không** có timestamp trong IR; thời gian sinh nằm ở Generation record.
3. Canonicalization: id đánh lại tất định (DFS từ trigger theo thứ tự `blockId`), key sort, số canonical, `irHash = sha256(canonical(IR \ {irHash}))`.
4. JSON Schema `ir.v1.schema.json` trong contracts; mọi IR sinh ra phải validate trong CI.
5. Logic/math inline vào expression tree của node tiêu thụ; node riêng chỉ cho thao tác có side-effect/yield/control.
6. Node do compiler chèn có `src.inserted=true, src.reason`.
7. Semver: thêm opcode = minor; đổi nghĩa/field bắt buộc = major.

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| IR = graph Sim nguyên bản | Buộc backend hiểu Sim; trái nguyên tắc 3.2 |
| IR dạng SSA/3-address code | Quá thấp cho người đọc/diff; backend C++ phải dựng lại cấu trúc |
| Giữ data edges | Dư thừa với tham chiếu; khó emit |

## Consequences
+ Backend đơn giản, IR đọc/diff được, hash ổn định. − Khi thêm data edges thật (nếu cần tương lai) phải major bump.

## Implementation
Schema + TS types + validator + canonicalizer + golden IR GW-A..G (M4).

## Verification
Golden IR diff = 0; determinism test (2 lần, 2 OS); schema validate tất cả IR.

## Notes / Deviations
**2026-10-06 — rà soát trước M4 (đối chiếu `contracts/schemas/ir.v1.schema.json` alpha, quy ước M2/M3, golden GW-A…G):**
1. **Khoá `next`:** schema chỉ cho `^[a-z][a-z0-9_]*$`, còn handle canvas có dấu gạch. Quy tắc map tất định từ handle BlockSpec (ADR-0011 Notes): `source` → `next`; handle khác giữ tên, `-` → `_` (`error`, `then`, `else`, `ok`, `timeout`, `stable`, `broken`, `case_0…`, `default`). Container: `loop-start-source` → `body.entry`; `loop-end-source`/`parallel-end-source` → `next.next`; mỗi edge `parallel-start-source` → một phần tử `args.branches[{entry}]`, sắp theo `blockId` đích. Handle không nối ⇒ `null` (khoá vẫn có mặt để backend thấy đủ nhánh).
2. **Fan-out bị cấm:** một handle (trừ `parallel-start-source`) nối tới nhiều block thì `next` không biểu diễn được và ngữ nghĩa mơ hồ. Đây là lỗi S1, mã mới `EDGE_FANOUT_NOT_ALLOWED` (thêm vào catalog theo ADR-0016, additive). Muốn chạy song song thì dùng container Parallel.
3. **`name`** (PascalCase theo schema) suy tất định từ tên workflow: tách theo ký tự không phải chữ/số, viết hoa chữ đầu mỗi phần, nối lại; rỗng hoặc bắt đầu bằng số ⇒ tiền tố `App`. Ví dụ "Stable Overspeed Warning" → `StableOverspeedWarning`.
4. **Tham chiếu:** `<blockname.out>` (tên chuẩn hoá Sim, ADR-0013 Notes) → `{"$ref":"n<k>.out"}`; `<Vehicle.…>` → `$signal`; `<variable.x>` → `$state`; `<loop.index>`/`<parallel.…>` → `$ref` tới node container.
5. **Prop expression dạng literal** (`value: true` trong graph cũ) ≡ nguồn SVX `String(v)` trước khi parse, nên graph tay và graph từ canvas cho cùng IR.
6. **Concurrency** ghi tường minh trong IR: `queue` ⇒ `queueMax: 8`, `parallel` ⇒ `maxRuns: 4` (conformance C12/C14), để mọi backend không phải tự giữ giá trị mặc định.
7. **`workflowRevision`** lấy từ graph (adapter studio gửi 0; server cấp revision khi lưu); không tham gia so sánh golden adapter.
8. Workflow mới **không còn block Start của Sim** (studio `lib/workflows/defaults.ts`, M03-T13); adapter vẫn bỏ qua mọi block không phải `sv_*`/container.
9. **Op biểu thức thuộc về phiên bản IR (M04-T07):** `capabilities.opcodes` (contract `backend-capabilities`) chỉ liệt kê opcode trigger/node; mọi op trong `$expr` (`+ − * / %`, so sánh, `&& || !`, `neg`, `?:`, hàm whitelist, `array.*`, `unit.convert`) là một phần của `irVersion` — backend khai báo hỗ trợ một phiên bản IR phải cài đủ chúng. S7 kiểm `irVersions` (semver range), opcode trigger/node và `features.concurrencyPolicies` (`OPCODE_UNSUPPORTED_BY_BACKEND` một lần mỗi block, `IR_VERSION_UNSUPPORTED`, `BACKEND_UNAVAILABLE`).
10. **Mỗi op `$expr` mang `type` (và `unit` khi có)** — chuỗi, hợp lệ với schema hiện tại (thuộc tính phụ kiểu string); backend không suy luận lại kiểu. `unit.convert` mang `from`/`to` và `scale`/`offset` dạng `$const` double (ADR-0015 Notes §8).
11. **Quy tắc hạ block (M04-T08, 2026-10-06):**
   - **Block thuần** (`sv_expression/compare/math/bool/clamp/scale/convert/lookup/constant/array_*`, opcode `expr`/`const`) chỉ được **inline** vào biểu thức nơi dùng khi biểu thức của nó **bất biến trong run** (chỉ tham chiếu output `$ref` và hằng; không `$signal`, `$state`, `now_ms()`) và nhánh `error` không nối. Ngược lại nó thành node `logic.eval` (args `value`, output `result`) tại đúng vị trí trên canvas: inline qua một điểm chờ (wait, wait_until, ghi có ack…) sẽ tính lại `<Vehicle.…>`/biến/`now_ms()` muộn hơn và đổi nghĩa so với canvas.
   - `sv_convert` ⇒ op `type.cast` (`to` là kiểu) hoặc `unit.convert` (`to` là unit VSS). Số thực ⇒ số nguyên: làm tròn gần nhất (0,5 ra xa 0), `NaN` ⇒ 0, kẹp vào miền kiểu đích; số nguyên ⇒ số nguyên hẹp hơn: kẹp.
   - `sv_hmi_notify` ⇒ `comm.mqtt_publish` lên topic `simvehicleapp/<tên app kebab-case>/hmi`, payload JSON `{"severity","title","message","ts"}`; tiêu đề/nội dung được escape bằng op mới `json.string` (op `$expr`, thuộc IR v1).
   - `sv_stable_for` bỏ trống `condition` ⇒ `$signal(s) == $ref(trigger.value)` của trigger `signal_changed` duy nhất dominate block; không có trigger như vậy ⇒ `BLOCK_PROPERTY_MISSING`.
   - Concurrency mặc định theo BlockSpec (`signal_changed`/`condition` restart, `timer` ignore, `mqtt` queue), ghi tường minh kèm `queueMax`/`maxRuns` (§6).
   - Id node: duyệt theo chiều sâu từ các trigger (sắp theo `blockId`), thăm handle ra theo thứ tự trong BlockSpec (`case_i` theo i, nhánh parallel theo `blockId` đích, thân container trước `next`); block được inline không có id. Bảng `signals` (theo path), `topics` (theo topic, hướng), `state` (theo tên) đánh số tương tự.
12. **`/compile` `target` tuỳ chọn (M04-T10):** OpenAPI ghi `target` "bắt buộc cho verify/build", nhưng backend chỉ có từ M6 ⇒ Verify ở M4 sẽ luôn `BACKEND_UNAVAILABLE`. Nới thành tuỳ chọn (không phá client): thiếu `target` ⇒ bỏ S7, IR trung lập với backend; S7 chạy lại khi sinh code với backend đích. Service đọc danh sách backend từ `SV_BACKENDS` (`id=url,…`).

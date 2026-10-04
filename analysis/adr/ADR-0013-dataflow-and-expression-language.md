# ADR-0013: Dataflow bằng tham chiếu `<…>` + expression language riêng (không eval)

- **Status:** Accepted (2026-10-04 — PO chấp thuận cùng Notes 2026-10-04) · **Date:** 2026-09-30 · **Level:** L1
- **Related:** Master Plan ADR-004 & Part 6.6; [06 §4](../06-ir-and-compiler.md); [00 F4](../00-research-findings.md#24-phát-hiện-quan-trọng--lệch-so-với-master-plan-v2)

## Context
Sim: edge = control-flow; dữ liệu qua `<blockName.field>` trong subBlock; Condition viết JS chạy `isolated-vm`. Với codegen tất định sang C++/Python/Rust, không thể nhúng JS tuỳ ý.

## Decision
1. **Giữ mô hình Sim**: edge = control; data = tham chiếu. Ba dạng tham chiếu: `<Tên block.field>`, `<Vehicle.Path>` (giá trị mới nhất đã cache), `<var.name>` (biến workflow).
2. **Expression language SimVehicleApp (SVX)** — grammar ở [06 §4](../06-ir-and-compiler.md): số (có đơn vị tuỳ chọn), string, bool, toán tử số học/so sánh/logic/ternary, hàm whitelist (`abs min max clamp round floor ceil scale in_range now_ms len`), template string `"Speed {<Speed.value>} km/h"`.
3. **Parser tự viết** (Pratt, TypeScript, ~600 LOC) trong `simvehicleapp-core/packages/expr`: lexer → parser → AST → typer (dùng type/unit system ADR-0015) → lowering `$expr`. Không dùng thư viện expression bên ngoài (tránh eval/prototype pollution và để kiểm soát typing/units).
4. Editor trong studio: ~~Monaco Editor~~ **bộ editor ô nhập của Sim** — `react-simple-code-editor` + `prismjs` (grammar SVX) + `TagDropdown` cho tham chiếu `<…>` (thêm nhóm Vehicle từ catalog); lint realtime qua `POST /lint`. *(Sửa 2026-10-04, PO chọn — xem Notes 2026-10-04; trước đó: Monaco 0.55.1.)*
5. Output của block có schema kiểu (từ BlockSpec) ⇒ tham chiếu typed.
6. Giới hạn: độ sâu AST ≤ 64, độ dài ≤ 2 000 ký tự.

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| JS (như Sim) | Không dịch được tất định sang C++; bảo mật |
| jsep / expr-eval / mathjs | Không có hệ đơn vị/kiểu như cần; mathjs quá lớn; một số có eval |
| CEL (Common Expression Language) | Mạnh nhưng runtime cần cho từng ngôn ngữ đích; ta chỉ cần compile-time |
| Data edges trên canvas (như node-RED) | Đổi mô hình Sim, canvas rối |

## Consequences
+ Tất định, typed, an toàn. − Phải viết/maintain parser + editor autocomplete.

## Implementation
| Task | Milestone |
|---|---|
| packages/expr (lexer/parser/typer/lowering) + 200 test case | M3 |
| Editor subblock `sv-expression` + autocomplete | M3 |
| Emitter expr cho C++ (M6), Python (M12) | |

## Mở rộng
Cú pháp index `ref[expr]` + hàm `len/at/contains` cho giá trị mảng (`T[]`): xem [ADR-0018](ADR-0018-vss-array-and-full-datatype-coverage.md) §3 (quyết định riêng, không lặp lại ở đây).

## Verification
Fuzz test parser (không crash, không treo); round-trip AST → IR → C++ biểu thức cho bảng test; test bảo mật chuỗi `"); system("rm -rf /` được escape.

## Notes / Deviations (2026-10-01)
Kiểm tra trực tiếp `apps/sim/package.json` của snapshot Sim v0.7.13: không có `codemirror`/`@codemirror/*`, chỉ có `@monaco-editor/react@4.7.0` + `monaco-editor@0.55.1`. Quyết định ban đầu "Monaco/CodeMirror" (lưỡng lự) được chốt dứt khoát thành **chỉ Monaco** để tái dùng bundle/theme đã có, tránh 2 thư viện editor trùng chức năng. Đồng bộ sửa ở `analysis/phases/M03-logic-flow-blocks.md`.

## Notes / Deviations (2026-10-04, rà source Sim v0.7.13 trước M3)
- **Tên trong tham chiếu block**: Sim chuẩn hoá tên block bằng `normalizeName` (`apps/sim/executor/constants.ts`: lowercase, bỏ khoảng trắng và dấu `.`) ⇒ block "When Speed changes 1" (tên do M2 đặt khi thả signal) được tham chiếu là `<whenspeedchanges1.value>`, không phải `<Tên block.field>` như §1 viết. SVX phải dùng đúng quy tắc này để tham chiếu khớp với dropdown `<…>` của Sim.
- **Xung đột `<Vehicle.Path>` ↔ tham chiếu block**: block tên "Vehicle"/"vehicle" chuẩn hoá thành `vehicle` ⇒ `<vehicle.speed>` mơ hồ. Đề xuất: tiền tố `Vehicle.` (phân biệt hoa/thường, đúng như VSS) dành riêng cho signal; tên block chuẩn hoá thành `vehicle` bị từ chối bằng diagnostic mới (stage S1) — cần thêm mã vào catalog (chỉ thêm, ADR-0016).
- **Editor (§4)**: Monaco có trong `package.json` nhưng Sim chỉ dùng nó cho trình xem file (`files/components/file-viewer/text-editor.tsx`); mọi ô nhập trong block (`code`, tool-input code editor, subflow editor) dùng `react-simple-code-editor` + `prismjs`, và gợi ý `<…>` là component `TagDropdown` dùng chung. Đề xuất cho `sv-expression`: dựa trên cùng bộ đó (prism grammar cho SVX + `TagDropdown` cho tham chiếu block + nhóm Vehicle từ catalog) để UX tham chiếu giống hệt Sim và tránh nạp Monaco trong mỗi block; Monaco giữ cho editor lớn (nếu cần). Thay đổi này đụng Decision §4 ⇒ cần PO chấp thuận.
- **Quyết định PO 2026-10-04**: Accept kèm Notes; editor `sv-expression` dùng bộ editor ô nhập của Sim (đã sửa Decision §4).
- **M03-T01/T03 (2026-10-04) — chi tiết cú pháp đã chốt khi cài parser** (`modules/simvehicleapp-core/packages/expr`):
  - Tham chiếu biến dùng tiền tố **`<variable.name>`** của Sim (`REFERENCE.PREFIX.VARIABLE`, `executor/constants.ts`), không phải `<var.name>` như §1; thêm `<loop.…>`, `<parallel.…>` (tiền tố Sim cho container lặp/song song). `<Vehicle.…>` phân biệt hoa/thường; mọi tiền tố khác là tham chiếu block (tên đã chuẩn hoá).
  - Đơn vị sau số: định danh liền sau số (`120 km/h`, `2 s`) là đơn vị trừ khi theo sau là `(`; `%` là đơn vị khi sau nó **không** có toán hạng (`20 % && …`), ngược lại là chia lấy dư (`20 % 3`). Tính hợp lệ của đơn vị do typer kiểm (ADR-0015).
  - So sánh **không kết hợp** (grammar `cmp := sum (op sum)?`): `1 < 2 == true` ⇒ `EXPR_SYNTAX/chained_comparison`; viết `(1 < 2) == true`.
  - Số giữ nguyên chuỗi thập phân trong AST (`raw`, không làm tròn — int64 an toàn, ADR-0018 §7).
  - Số tham số hàm whitelist: `abs/floor/ceil/len` 1, `round` 1–2, `min/max` 2–16, `clamp/in_range` 3, `scale` 5, `now_ms` 0, `at` 2–3, `contains` 2. Tra whitelist chỉ theo own-property (test đã bắt `constructor(…)`/`__proto__(…)` lọt qua prototype — đã sửa).
  - Lỗi dùng mã sẵn có `EXPR_SYNTAX` (kèm `data.reason`) và `EXPR_UNKNOWN_FUNCTION` — không thêm mã mới. Template `"…{expr}…"` (T03) parse đệ quy, `\{`/`\}` để viết ngoặc.
- **M03-T07 (2026-10-04) — prop kiểu `template` (`sv_log.message`, `sv_mqtt_publish.payload`, `sv_hmi_notify.title/message`)**: dùng ô `long-input` của Sim, nơi `TagDropdown` chèn `<ref>` **trực tiếp trong văn bản** (`Speed is <Vehicle.Speed>`), giống mọi ô văn bản của Sim. Compiler (M4) coi nội dung prop template là văn bản thô: `<ref>` hợp lệ được nội suy, `{biểu thức}` được tính (như template SVX); `\{`/`\}` để viết ngoặc. Trong một biểu thức SVX, template vẫn là chuỗi có ngoặc kép `"…{<ref>}…"` (§2).
- **M03-T11 (2026-10-04) — sửa ghi chú M03-T07 về prop `template`:** prop template **chỉ** nội suy `<ref>` viết thẳng trong văn bản; ngoặc nhọn là chữ thường, **không** có `{biểu thức}`. Lý do: lint chạy trên GW-E phát hiện payload JSON (`{"speed": <Vehicle.Speed>, …}`) bị hiểu thành biểu thức — bắt người no-code escape mọi ngoặc JSON là không chấp nhận được. Cần tính toán ⇒ dùng block Expression rồi tham chiếu `<expressionname.result>`. Template trong **biểu thức SVX** (`"…{<ref>}…"`, §2) giữ nguyên. GW-A/GW-B và semantics `sv_log`/`sv_mqtt_publish` cập nhật theo.

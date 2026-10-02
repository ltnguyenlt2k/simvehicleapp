# ADR-0013: Dataflow bằng tham chiếu `<…>` + expression language riêng (không eval)

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L1
- **Related:** Master Plan ADR-004 & Part 6.6; [06 §4](../06-ir-and-compiler.md); [00 F4](../00-research-findings.md#24-phát-hiện-quan-trọng--lệch-so-với-master-plan-v2)

## Context
Sim: edge = control-flow; dữ liệu qua `<blockName.field>` trong subBlock; Condition viết JS chạy `isolated-vm`. Với codegen tất định sang C++/Python/Rust, không thể nhúng JS tuỳ ý.

## Decision
1. **Giữ mô hình Sim**: edge = control; data = tham chiếu. Ba dạng tham chiếu: `<Tên block.field>`, `<Vehicle.Path>` (giá trị mới nhất đã cache), `<var.name>` (biến workflow).
2. **Expression language SimVehicleApp (SVX)** — grammar ở [06 §4](../06-ir-and-compiler.md): số (có đơn vị tuỳ chọn), string, bool, toán tử số học/so sánh/logic/ternary, hàm whitelist (`abs min max clamp round floor ceil scale in_range now_ms len`), template string `"Speed {<Speed.value>} km/h"`.
3. **Parser tự viết** (Pratt, TypeScript, ~600 LOC) trong `simvehicleapp-core/packages/expr`: lexer → parser → AST → typer (dùng type/unit system ADR-0015) → lowering `$expr`. Không dùng thư viện expression bên ngoài (tránh eval/prototype pollution và để kiểm soát typing/units).
4. Editor trong studio: **Monaco Editor** (`@monaco-editor/react` 4.7.0 + `monaco-editor` 0.55.1 — đã có sẵn trong `package.json` của Sim, dùng chung với các editor khác của studio, không thêm thư viện mới) với ngôn ngữ tuỳ biến đăng ký qua `monaco.languages.register` (token provider + completion provider cho `<…>`) và lint realtime qua `POST /lint`.
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

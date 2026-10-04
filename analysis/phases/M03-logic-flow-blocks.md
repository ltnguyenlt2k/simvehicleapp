# M3 — Logic, Flow, State, Communication blocks + Expression language + Lint

**Mục tiêu:** đủ block P0 (và P1 chọn lọc) để dựng 7 golden workflow trên canvas; expression editor; lint realtime.
**ADR:** 0012, 0013 · **Phụ thuộc:** M2 · Master Plan Phase 8–9
**Tham khảo UI:** với mỗi BlockSpec ở các task dưới, xem cột "Cơ chế Sim tham khảo" ở [11b §7](../11b-block-inventory-and-migration.md#7-bảng-tổng-41-block-mới--cơ-chế-sim-tham-khảo--vss-minh-hoạ-đã-verify-thật) trước khi thiết kế UI — không import/gọi code block cũ, chỉ tham khảo layout.

## Tasks
| ID | Task | Module | Test |
|---|---|---|---|
| M03-T01 | `packages/expr`: lexer, Pratt parser, AST, lỗi có vị trí | core | 200 case + fuzz |
| M03-T02 | Tham chiếu `<…>` (block output, Vehicle path, var) + resolver interface | core | |
| M03-T03 | Template string `"…{<ref>}…"` | core | |
| M03-T04 | BlockSpec: sv_on_app_start, sv_on_timer, sv_on_mqtt, sv_on_condition(P1), sv_compare, sv_bool, sv_math, sv_expression, sv_constant, sv_scale, sv_clamp, sv_in_range, sv_lookup, sv_convert | core | spec tests |
| M03-T05 | BlockSpec flow: sv_if, sv_switch, sv_wait, sv_wait_until, sv_stable_for, sv_repeat, sv_while, sv_parallel (dùng subflow container Sim), sv_stop | core | |
| M03-T06 | BlockSpec state/comm: sv_var_get/set, sv_counter, sv_log, sv_mqtt_publish, sv_hmi_notify | core | |
| M03-T07 | UI BlockConfig tương ứng + handles đúng tên (`then/else`, `ok/timeout`, `stable/broken`, `done/error`) | studio | block-parity |
| M03-T08 | SubBlock `sv-expression` (bộ editor ô nhập của Sim: `react-simple-code-editor` + prism grammar SVX, `TagDropdown` cho ref block phía trước + nhóm Vehicle từ catalog — ADR-0013 §4 sửa 2026-10-04), `sv-duration` (500 ms / 2 s) | studio | component test |
| M03-T09 | Panel Variables (khai báo tên/kiểu/giá trị đầu) | studio | |
| M03-T10 | Map subflow `parallel` & `loop` của Sim sang sv_parallel/sv_repeat/sv_while (reuse container UI) | studio | |
| M03-T11 | `POST /lint` (S0–S3 + một phần S6) + debounce 300 ms + badge trên block + tab Problems | core+studio | lint rules §4 file 05 |
| M03-T12 | Conformance scenarios (≥ 30) cho semantics ADR-0012 | contracts | schema validate |
| M03-T13 | Dựng 7 golden workflow trên canvas, export `sim-state.json` vào fixtures | contracts | |
| M03-T14 | Clean-room review checklist ký trong PR | — | |

## DoD / Gate
- 7 golden dựng được trên UI không lỗi lint error.
- Parser pass fuzz 10 phút không crash.
- Conformance scenarios review xong (là "executable spec" cho M5/M6).

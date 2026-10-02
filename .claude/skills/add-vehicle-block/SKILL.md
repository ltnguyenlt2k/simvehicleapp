---
name: add-vehicle-block
description: Use when adding or changing a SimVehicleApp block (trigger, sensor, actuator, logic, flow, state, communication, composite) — covers BlockSpec in core, BlockConfig UI in studio, lowering to IR, simulator behavior, runtime/codegen support, migrations, and tests.
---

# Thêm / sửa block

Tham chiếu: `analysis/05-blocks-and-execution-model.md`, ADR-0011/0012/0013/0014/0018.

## Block chạm VSS kiểu mảng (`T[]`) — ADR-0018
Mảng luôn **read-only** (0 actuator kiểu mảng trong VSS thật) ⇒ không viết editor "set mảng", `sv_set_actuator` không bao giờ nhận path mảng. Đọc/dùng giá trị mảng chỉ qua 3 block có sẵn `sv_array_length`/`sv_array_at`/`sv_array_contains` (nhóm Logic & Math) — không tạo props kiểu mảng tuỳ biến trong block mới; nếu cần phần tử ⇒ gọi `array.at` trong lowering, không viết `arr[0]` trực tiếp. `int64`/`uint64` (kể cả dạng mảng) luôn string-encode trong spec/IR JSON.

## Các nơi phải chạm (theo thứ tự)
1. **Semantics trước**: viết `simvehicleapp-core/packages/blocks/<name>/semantics.md` (input, output, handle ra, yield?, side-effect, edge cases, concurrency).
2. **BlockSpec** `spec.json` (validate bằng `block-spec.v1.schema.json`): `type` (`sv_*`), `version`, `category`, `props` (id, kind, type, required, default, constraints), `outputs` (typed), `handles`, `opcode` hoặc `lowering`.
3. **Lowering** `lowering.ts`: block → IR node(s)/expr. Logic thuần ⇒ inline `$expr`, không tạo node.
4. **Simulator** `simulator.ts` (nếu opcode mới) + conformance scenario trong contracts nếu có ngữ nghĩa thời gian/đồng thời.
5. **Diagnostics** mới (nếu có) thêm vào catalog — không đổi mã cũ.
6. **UI** `simvehicleapp-studio/apps/sim/blocks/vehicle/<name>.ts` (BlockConfig) + subBlock phù hợp (`vss-path-selector`, `sv-expression`, `sv-duration`, `sv-enum`, `sv-typed-value`); handle IDs khớp spec.
7. **Backends**: emitter trong mỗi `compiler-code-<lang>` hỗ trợ; nếu chưa ⇒ không liệt kê opcode trong `backend.yaml` (compiler S7 sẽ báo `OPCODE_UNSUPPORTED_BY_BACKEND`).
8. **Migration** `migrations.ts` khi tăng `version` (breaking): nâng props cũ → mới; test với workflow cũ.

## Definition of Done
- [ ] semantics.md, spec.json, lowering, simulator (nếu cần), unit test mỗi prop required.
- [ ] `block-parity.test.ts` pass (UI ↔ spec).
- [ ] Emitter + golden ở backend hỗ trợ; conformance pass.
- [ ] Nếu là block P0/P1: thêm vào ít nhất 1 golden workflow.
- [ ] Vehicle block: kiểm tra đúng access sensor/actuator qua catalog.
- [ ] Clean-room: không dùng tên/khái niệm cụ thể lấy từ code Scratch.

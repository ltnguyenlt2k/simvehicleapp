# BLOCK_SDK — một khối SimVehicleApp gồm những gì

Một khối (`sv_*`) là **một BlockSpec** được nhiều module dùng chung qua contract — không module nào import code của
module khác (AGENTS §2.2). Quy trình thêm/sửa: [ADD_NEW_BLOCK](ADD_NEW_BLOCK.md). Tham chiếu sinh tự động:
[docs/user-guide/blocks.md](../user-guide/blocks.md). Nền tảng: [analysis/05](../../analysis/05-blocks-and-execution-model.md),
ADR-0011 (BlockSpec), ADR-0012 (ngữ nghĩa thực thi), ADR-0013 (biểu thức SVX), ADR-0018 (kiểu, mảng, int64).

## 1. Nguồn sự thật: `modules/simvehicleapp-core/packages/blocks/<type>/`
| File | Nội dung |
|---|---|
| `semantics.md` | Ngữ nghĩa viết trước code: input/output, handle ra, có yield không, side-effect, edge case, đồng thời. |
| `spec.json` | BlockSpec v1 — validate bằng `modules/simvehicleapp-contracts/schemas/block-spec.v1.schema.json`. |

Trường của `spec.json`:
- `type` (`sv_…`, không đổi tên), `version` (tăng khi breaking ⇒ cần migration), `category` (`triggers`, `sensors`,
  `actuators`, `attributes`, `logic`, `flow`, `state`, `comm`), `title`, `priority` (P0/P1…).
- `opcode`: opcode IR mà khối hạ xuống (danh sách và ngữ nghĩa: [IR_SPEC](../../modules/simvehicleapp-contracts/IR_SPEC.md)).
  `expr` = khối thuần, được **gộp** vào biểu thức của node dùng output, không sinh node.
- `props`: `name`, `kind` (`vss-path`, `expression`, `template`, `typed-value`, `duration`, `enum`, `boolean`, `list`,
  `number`, `string`…), `required`, `default`, `enum`, ràng buộc.
- `outputs`: tên + kiểu (tham chiếu được trong biểu thức `<tênkhối.output>`).
- `handles`: `in` (thường `target`; trigger không có) và `out` (`source`, `then`/`else`, `stable`/`broken`, `error`…).

## 2. Ai dùng BlockSpec
| Nơi | Dùng để |
|---|---|
| `core/packages/blocks/src/index.ts` (`BLOCK_SPECS`) | đăng ký mọi spec; compiler phục vụ `GET /blocks` |
| `core/packages/compiler/src/compile.ts` | S2 kiểm prop, hạ khối ⇒ IR (`switch` theo `type`), S4/S5 kiểu & đơn vị |
| `core/packages/compiler/src/migrations.ts` | nâng props khi `version` tăng |
| `core/packages/simulator/src/simulator.ts` | thực thi IR theo ngữ nghĩa ADR-0012 (Simulate, P2) |
| `studio/apps/sim/blocks/vehicle/block-specs.json` | **bản chụp** spec cho studio (không import core) — đồng bộ bằng `scripts/ci/block_specs_sync.py` |
| `studio/apps/sim/blocks/vehicle/*.ts` | BlockConfig của Sim (subBlocks, icon) sinh từ spec qua `factory.ts`; `block-parity.test.ts` bắt lệch |
| `compiler-code-cpp/generator/src/emit.ts` + `backend.yaml` | emitter C++ cho từng opcode; opcode không có trong `backend.yaml` ⇒ compiler báo `OPCODE_UNSUPPORTED_BY_BACKEND` |
| `compiler-code-cpp/runtime/` | runtime C++ (strand, yield, chính sách trigger), API: [RUNTIME_API](../../modules/compiler-code-cpp/runtime/RUNTIME_API.md) |
| `simvehicleapp-ai/src/tools.ts` | trợ lý AI đọc catalog khối từ compiler để đề xuất WorkflowPatch |

## 3. Luật
- Không LLM trong đường sinh code; codegen tất định (cùng IR ⇒ cùng byte).
- Mã diagnostic là API công khai: chỉ thêm, không đổi tên/xoá ([DIAGNOSTICS_CATALOG](../../modules/simvehicleapp-contracts/DIAGNOSTICS_CATALOG.md)).
- Mảng VSS luôn read-only; truy cập qua `sv_array_length`/`sv_array_at`/`sv_array_contains`. `int64`/`uint64` là chuỗi thập phân trong JSON.
- Khối VSS kiểm sensor/actuator theo catalog (ghi sensor ⇒ `VEHICLE_WRITE_READ_ONLY`).
- Clean-room: không lấy tên/khái niệm từ Scratch (AGPL).

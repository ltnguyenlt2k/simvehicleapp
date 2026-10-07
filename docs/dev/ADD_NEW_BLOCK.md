# ADD_NEW_BLOCK — thêm hoặc sửa một khối

Giải phẫu khối: [BLOCK_SDK](BLOCK_SDK.md). Làm theo thứ tự; mỗi bước có lệnh kiểm. Lệnh `bun` chạy trong thư mục module
(hoặc container `oven/bun:1.3.8` với `--user $(id -u):$(id -g)`).

## 1. Ngữ nghĩa trước
Viết `modules/simvehicleapp-core/packages/blocks/<type>/semantics.md`: input, output, handle ra, yield, side-effect,
edge case (giá trị thiếu, timeout, huỷ), đồng thời (trigger `restart`/`ignore`/`queue`/`parallel`).

## 2. BlockSpec
Tạo `spec.json` cạnh đó và đăng ký trong `packages/blocks/src/index.ts`. Ưu tiên tái dùng opcode có sẵn
([IR_SPEC](../../modules/simvehicleapp-contracts/IR_SPEC.md)); khối thuần logic ⇒ `opcode: "expr"`.
```bash
cd modules/simvehicleapp-core && bun test packages/blocks     # schema + đăng ký
```

## 3. Hạ xuống IR (compiler)
Thêm nhánh cho `type` trong `packages/compiler/src/compile.ts`; lỗi người dùng ⇒ mã có trong catalog (mã mới: thêm vào
`modules/simvehicleapp-contracts/schemas/diagnostics-catalog.v1.json`, rồi `bun run gen` trong contracts để sinh lại
DIAGNOSTICS_CATALOG). Viết test "cố ý sai" ⇒ đúng mã.

## 4. Simulator (nếu opcode mới)
`packages/simulator/src/simulator.ts`. Ngữ nghĩa thời gian/đồng thời ⇒ thêm conformance case
`modules/simvehicleapp-contracts/fixtures/conformance/C<nn>-<slug>/` (graph + scenario + expected).
```bash
cd modules/simvehicleapp-core && bun test && bun run check
bun packages/compiler/src/golden-ir.ts --write && bun packages/simulator/src/golden-trace.ts --write   # khi IR/trace của golden đổi — review diff
```

## 5. Studio
```bash
python3 scripts/ci/block_specs_sync.py --write     # chụp lại spec cho studio
```
BlockConfig ở `modules/simvehicleapp-studio/apps/sim/blocks/vehicle/` (đa số sinh từ spec qua `factory.ts`; khối có UI riêng
như `on-signal-changed.ts` viết tay). Chạy `block-parity.test.ts` (vitest). Không chạy `biome --write` lên `lib/sv/__golden__`.

## 6. Backend C++
Emitter trong `modules/compiler-code-cpp/generator/src/emit.ts`, thêm opcode vào `backend.yaml`; runtime nếu cần.
```bash
cd modules/compiler-code-cpp/generator && bun test                   # golden C++ GW-A…G phải không đổi
SV_UPDATE_GOLDEN=1 bun test                                          # chỉ khi thay đổi là chủ ý — review diff
generator/conformance/conformance.sh                                 # P1: build + chạy trên mock vehicle (toolchain)
```

## 7. Migration
Tăng `version` (breaking) ⇒ `packages/compiler/src/migrations.ts` nâng props cũ; test với workflow cũ.

## 8. Golden và parity
Khối P0/P1 ⇒ có mặt trong ít nhất một golden (`fixtures/golden/GW-*`). Parity:
P1 conformance (CI), P2 simulator (CI), P3 binary thật trên KUKSA (`modules/simvehicleapp-orchestrator/gate/parity-p3.sh`, nightly).

## Definition of Done
- [ ] semantics.md, spec.json, lowering, simulator (nếu cần), test cho mỗi prop bắt buộc
- [ ] block-specs đồng bộ, `block-parity.test.ts` pass
- [ ] emitter + golden C++ + conformance P1 pass; P3 nightly xanh
- [ ] tham chiếu khối sinh lại: `python3 scripts/docs/gen_block_reference.py`

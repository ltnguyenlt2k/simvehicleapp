# Module: `simvehicleapp-core`

**Tầng:** L3 (domain, thuần) · **ADR:** 0010–0017 · **Milestone:** M2–M5
**Containers:** `vss-catalog` :4010, `compiler` :4020

## Cấu trúc (Bun workspaces)
```
packages/
  vss/          # parser, classify, hash, search index  (VehicleModelSource: LocalFile, Http, Overlay)
  types/        # type lattice, VSS→type
  units/        # units/quantities, conversion table
  expr/         # SVX lexer/parser/typer/lowering
  blocks/       # BlockSpec cho mọi sv_* (spec.json, semantics.md, migrations.ts, lowering.ts, simulator.ts, test)
  compiler/     # normalize, S0–S7, IR builder, canonicalize, hash
  diagnostics/  # catalog + builder + i18n keys
  simulator/    # VirtualClock, Strand, MockVehicle, MockMqtt, Tracer, ScenarioPlayer
services/
  vss-catalog/  # HTTP (Hono/Elysia trên Bun), cache, ETag
  compiler/     # HTTP: /compile /lint /simulate /blocks /opcodes
test/golden/    # dùng fixtures từ contracts
```
## Quy tắc
- Package **thuần**: không đọc fs/mạng (trừ `vss` source adapters và services).
- Không import code module khác ngoài `@simvehicleapp/contracts`.
- Hiệu năng: lint ≤ 100 ms, compile ≤ 300 ms cho 200 block.

## API chính
Xem [03 §7](../03-system-architecture.md#7-api-bề-mặt-tóm-tắt-schema-đầy-đủ-trong-simvehicleapp-contracts), [06](../06-ir-and-compiler.md).

# simvehicleapp-core

Domain core của SimVehicleApp (tầng L3): VSS catalog, hệ kiểu, expression, BlockSpec, compiler, simulator.
Spec: [analysis/modules/simvehicleapp-core.md](../../analysis/modules/simvehicleapp-core.md).

Bun workspace (bun 1.3.8, giống CI). Chỉ phụ thuộc `@simvehicleapp/contracts` (`file:../simvehicleapp-contracts`).

```bash
bun install --frozen-lockfile
bun run check   # tsc --noEmit
bun test
```

| Package | Nội dung | Milestone |
|---|---|---|
| `packages/vss` (`@simvehicleapp/vss`) | Parse VSS release JSON → node chuẩn hoá (shape `VssNode` của `openapi/vss-catalog.v1.yaml`), phân loại block khả dụng, `modelHash` = sha256 JSON canonical (key sắp xếp). int64/uint64 → chuỗi thập phân (ADR-0018 §7); lỗi cấu trúc ⇒ `VssParseError`, không bỏ dữ liệu. Nguồn (`VehicleModelSource`): `LocalFileSource` (seed, layout `<dir>/<vX.Y>/vss_rel_X.Y.json`), `HttpSource` (chỉ release có pin sha256 trong `COVESA_PINS`, cache `sv-vss`), `CompositeSource`. Search: `buildSearchIndex(model).search(q, {kind, limit})`. | M02-T01..T03 |

Node gốc (`Vehicle`) có trong `model.nodes` nhưng không hợp lệ theo `vssPath` của contract (cần ≥ 1 dấu chấm) — service chỉ trả các node con của gốc.

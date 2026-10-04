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

| `packages/blocks` (`@simvehicleapp/blocks`) | BlockSpec mỗi block `sv_*`: `<type>/spec.json` (validate `block-spec.v1`) + `semantics.md`; `BLOCK_SPECS` sắp theo `type`. M2: `sv_on_signal_changed`, `sv_read_signal`, `sv_read_attribute`, `sv_set_actuator`; test đối chiếu `vssKinds` với `blocksFor` trên mọi node VSS 4.0/4.2. | M02-T05 |
| `packages/expr` (`@simvehicleapp/expr`) | SVX (ADR-0013): lexer + Pratt parser → AST có span, template `"…{expr}…"`, whitelist hàm, giới hạn 2 000 ký tự / độ sâu 64; lỗi `EXPR_SYNTAX`/`EXPR_UNKNOWN_FUNCTION` kèm `reason`. Fuzz: `bun packages/expr/src/fuzz.ts <giây> [seed]`. Tham chiếu: `collectRefs`, `checkRefs(ast, RefResolver)` → `EXPR_UNKNOWN_REF` kèm `reason` (block, signal, biến, loop/parallel, tên `vehicle` dành riêng). | M03-T01..T03 |
| `services/vss-catalog` | HTTP `:4010` (chỉ mạng `sv-internal`) theo `openapi/vss-catalog.v1.yaml`: `/releases`, `/tree`, `/search`, `/nodes`, `/model-hash` + `/healthz`, `/version` (service-kit, auth `x-sv-internal`). Cache parse theo release, ETag mạnh. Env: `SV_VSS_DEFAULT_RELEASE` (v4.0), `SV_VSS_HTTP` (0 = offline), `SV_VSS_SEED_DIR`, `SV_VSS_CACHE_DIR`. | M02-T04 |
| `services/compiler` | HTTP `:4020` (nội bộ) theo `openapi/compiler.v1.yaml`. Skeleton M2: `GET /blocks` (BlockSpec, ETag); `/compile`, `/lint`, `/opcodes` (M4) và `/simulate` (M5) trả `501 not_implemented` cho tới khi có thật. | M02-T06 |

Image: `docker compose build contracts && docker compose build vss-catalog compiler` (hoặc `scripts/sv build`); contracts vào build qua `additional_contexts: docker-image://simvehicleapp/contracts:dev`.

Node gốc (`Vehicle`) có trong `model.nodes` nhưng không hợp lệ theo `vssPath` của contract (cần ≥ 1 dấu chấm) — service chỉ trả các node con của gốc.

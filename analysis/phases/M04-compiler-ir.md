# M4 — Compiler: WorkflowGraph → IR v1 + Diagnostics

**Mục tiêu:** Verify hoạt động end-to-end trên UI; IR tất định, validate schema; toàn bộ diagnostics P0.
**ADR:** 0014, 0015, 0016 · **Phụ thuộc:** M3 · Master Plan Phase 10–12

## Tasks
| ID | Task | Module | Test |
|---|---|---|---|
| M04-T01 | `graph-adapter.ts` Sim BlockState/Edge/subflow → WorkflowGraph v1 (thuần) | studio | golden sim-state→graph cho GW-A..G |
| M04-T02 | `packages/types` + `packages/units` (bảng conversion, dimension) | core | ≥ 100 case type; unit table test |
| M04-T03 | S0 parse/limits, S1 structural, S2 block config (+migrations blockVersion) | core | case cố ý sai mỗi mã |
| M04-T04 | S3 vehicle model (qua `VehicleModelProvider` → catalog batch) | core | |
| M04-T05 | S4 types (expr typer), S5 units (+ chèn `unit.convert`) | core | |
| M04-T06 | S6 control flow: cycle (ngoài container), dominator cho `$ref`, reachability, loop guard, parallel | core | |
| M04-T07 | S7 backend capability (client `/capabilities` + cache; stub backend cho test) | core | |
| M04-T08 | IR builder + inline logic vào `$expr` + canonicalize + `irHash` | core | golden IR GW-A..G; determinism 2 lần |
| M04-T09 | Diagnostics catalog v1 + builder + i18n keys + `docs/DIAGNOSTICS_CATALOG.md` sinh tự động | core/contracts | snapshot catalog |
| M04-T10 | Service `compiler` `/compile` (modes lint/verify/build) + OpenAPI | core | contract test; perf 200 block < 300 ms |
| M04-T11 | UI: nút Verify, Problems panel (click → focus block/field), quick-fix `Convert` | studio | Playwright |
| M04-T12 | `docs/IR_SPEC.md` sinh từ schema + ví dụ | contracts | |

## Gate
- Golden IR GW-A..G khớp snapshot (review thủ công lần đầu).
- Mỗi mã error P0 có test cố ý sai → đúng mã, đúng blockId (Master Plan Phase 12 gate).
- IR của mọi golden validate JSON Schema.

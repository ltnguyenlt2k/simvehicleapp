# M2 — VSS Catalog, Toolbar Vehicle, block Sensor/Actuator/Trigger

**Mục tiêu:** kéo tín hiệu VSS từ toolbar tạo block Read / When changes / Set / Attribute; đổi VSS release không rebuild frontend.
**ADR:** 0010, 0011 · **Phụ thuộc:** M1 · Master Plan Phase 3–7

## Tasks
| ID | Task | Module | Kết quả | Test |
|---|---|---|---|---|
| M02-T01 | `packages/vss`: parse JSON release, classify, normalize node schema, canonical hash | core | | fixture ≥ 20 path (Speed sensor/float/km/h; Hazard.IsSignaling actuator/bool; Wiping.Mode allowed; VIN attribute; counts 287/425/379/106) |
| M02-T02 | Sources: LocalFile (seed v4.0, v4.2), Http (cache `sv-vss`, pin tag) | core | | offline test |
| M02-T03 | Search index (path/name/description, fuzzy, filter kind) | core | | top-5 cho "state of charge" chứa `…StateOfCharge.Current` |
| M02-T04 | Service `vss-catalog` API + ETag + OpenAPI conformance | core | :4010 | contract test |
| M02-T05 | BlockSpec schema + spec cho `sv_read_signal`, `sv_read_attribute`, `sv_set_actuator`, `sv_on_signal_changed` (+ semantics.md) | core/blocks | | spec validate |
| M02-T06 | Endpoint `GET /blocks` (compiler service skeleton) | core | | |
| M02-T07 | SubBlock `vss-path-selector` (tree + search, filter theo kind cho phép, hiển thị type/unit/allowed) | studio | | component test |
| M02-T08 | SubBlock `sv-typed-value`, `sv-enum` | studio | | |
| M02-T09 | BlockConfig UI 4 block vehicle trong `blocks/vehicle/` + đăng ký | studio | | `block-parity.test.ts` |
| M02-T10 | Panel Vehicle trong toolbar (lazy tree, search, icon theo kind, badge unit) + drag → menu Read/When changes/Set | studio | | Playwright: kéo Speed → Read; sensor không có Set |
| M02-T11 | Project settings tối thiểu: chọn VSS release (lưu ở workflow/project metadata tạm thời cho tới M7) | studio | | |
| M02-T12 | BFF proxy `/api/sv/catalog/*` | studio | | |

## DoD
- [x] Toolbar Vehicle hiển thị cây VSS 4.0 (1 197 node, lazy). — E2E + smoke `/tree` (2026-10-04, [M02](../../docs/reports/M02.md))
- [x] 4 block vehicle kéo/thả/cấu hình/lưu được. — E2E gate + block-parity
- [x] Đổi release v4.0↔v4.2 ⇒ cây đổi, không rebuild. — E2E test 3

## Acceptance Gate
Test fixture catalog PASS; E2E tạo workflow tối thiểu "When Speed changes → Set Hazard.IsSignaling = true"; restart studio giữ nguyên.

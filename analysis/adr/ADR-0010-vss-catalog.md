# ADR-0010: VSS Catalog service (nguồn duy nhất cho toolbar & validator)

- **Status:** Accepted (2026-10-04 — PO chấp thuận cùng Notes 2026-10-04) · **Date:** 2026-09-30 · **Level:** L1
- **Related:** FR-VSS-01..03, R2; Master Plan Part 5.1–5.3; [00 §3.9](../00-research-findings.md#39-vss-40-json-đã-tải-và-phân-tích)

## Context
VSS 4.0 JSON (~260 KB, 1 197 node: 287 branch, 425 actuator, 379 sensor, 106 attribute). Template Velocitas trỏ AppManifest tới `vss_rel_4.0.json`. Toolbar và compiler phải dùng cùng dữ liệu. VSS mới nhất v6.1 nhưng model generator Velocitas hỗ trợ 3.x/4.x.

## Decision
1. Service `vss-catalog` (TS/Bun) trong `simvehicleapp-core`; parser là package `@simvehicleapp/vss` dùng chung (compiler chỉ dùng qua HTTP hoặc inject provider — **không** parse lần 2).
2. **Nguồn** (interface `VehicleModelSource`): `LocalFile` (seed trong image: `vss_rel_4.0.json`, `vss_rel_4.2.json` + `units.yaml`, `quantities.yaml`), `Http` (tải release COVESA, cache volume `sv-vss`, pin theo tag), `Overlay` (P2: vspec overlay của OEM, cần vss-tools để build JSON — chạy ngoài service).
3. Mỗi project pin `vssRelease`; `modelHash = sha256(canonical JSON sorted keys)`.
4. API: `GET /releases`, `GET /tree?release&prefix&depth` (lazy tree cho toolbar), `GET /search?q&type&release` (tên, path, description; fuzzy), `GET /nodes?paths=` (batch cho compiler), `GET /model-hash`.
5. Node schema: `{path, name, kind: branch|sensor|actuator|attribute, datatype, unit, min, max, allowed, default, description, comment?, deprecation?: string, uuid}`. `comment` (ghi chú bổ sung, tách khỏi `description`) và `deprecation` (chuỗi tự do mô tả lý do/thay thế, **không phải boolean**) là field thật đã verify trong VSS JSON (xem Notes).
6. Quy tắc khả dụng block: sensor → Read + OnChanged; actuator → Read + OnChanged + Set; attribute → ReadAttribute; branch → chỉ nhóm.
7. Cache parse in-memory theo release; ETag cho HTTP.
8. Databroker phải nạp **đúng file VSS** của release đang chạy (compose mount cùng file).

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| Sinh 1 file TS block cho mỗi signal lúc build | Đổi VSS phải rebuild frontend (vi phạm R4); >1000 file |
| Đọc metadata từ databroker (GetMetadata) | Phụ thuộc runtime đang chạy; không có khi thiết kế offline |
| Mặc định VSS v6.1 | Không khớp template/model generator Velocitas |

## Consequences
+ Đổi VSS không rebuild; 1 nguồn dữ liệu. − Một release/1 databroker tại một thời điểm (MVP).

## Implementation
| Task | Milestone |
|---|---|
| Parser + classification + hash + fixture test (≥ 20 path biết trước) | M2 |
| Service + API + cache + search | M2 |
| Seed releases trong image | M2 |

## Verification
Test cố định: `Vehicle.Speed` = sensor/float/km/h; `Vehicle.Body.Lights.Hazard.IsSignaling` = actuator/boolean; `Vehicle.Body.Windshield.Front.Wiping.Mode.allowed` chứa `RAIN_SENSOR`; đếm loại node v4.0 khớp số liệu trên; `Vehicle.Cabin.DoorCount.default == 4`; parse v4.2 (`sv_4_2` fixture) và kiểm `Vehicle.Body.RefuelPosition.deprecation == "v4.1 replaced with Vehicle.Powertrain.TractionBattery.Charging.ChargePortPosition and Vehicle.Powertrain.FuelSystem.RefuelPortPosition"` để có ca test `deprecation` thật (xem Notes — v4.0 không có entry nào deprecated nên không tự kiểm được bằng fixture v4.0 một mình).

## Notes / Deviations (2026-10-01)
Đã tải trực tiếp `vss_rel_4.0.json` và `vss_rel_4.2.json`, quét toàn bộ key xuất hiện trên leaf node:
- v4.0: `{allowed, comment, datatype, default, description, max, min, type, unit, uuid}` — có `comment` (ADR trước đây chưa liệt kê field này) và `default` (29/910 leaf, luôn ở `attribute`, trừ 1 ca `actuator` có default là `Vehicle.Powertrain.TractionBattery.Charging.ChargeLimit.default=100`); **không** có entry nào mang `deprecation` trong v4.0 (giải thích: release này không có signal nào bị deprecate, không phải do field sai tên).
- v4.2: có 165 entry mang `deprecation`, xác nhận field name **đúng là `"deprecation"`** (giá trị chuỗi tự do, ví dụ ở trên) — khớp tài liệu COVESA rule_set (field chỉ đổi thành `x-deprecation` khi xuất bằng exporter JSONSCHEMA với `--extended-all-attributes`, không phải định dạng JSON phẳng mà SimVehicleApp dùng).
- Datatype thực tế dùng trong v4.0: `boolean, double, float, int8, int16, int32, string, string[], uint8, uint16, uint32, uint8[]` — không có `int64/uint64` (khớp ghi chú ở ADR-0015, giữ nguyên là "dự phòng theo spec, chưa có data dùng").

## Notes / Deviations (2026-10-04, rà lại trước M2)
Đối chiếu lại với fixture trong repo và release asset COVESA (tải trực tiếp, không từ trí nhớ):
- `modules/simvehicleapp-contracts/fixtures/vss/vss_rel_4.0.json` (sha256 `925d9e1b…`): 1 197 node = 287/425/379/106 ✔; `Vehicle.Speed` sensor/float/km/h ✔; `Hazard.IsSignaling` actuator/boolean ✔; `Wiping.Mode.allowed ∋ RAIN_SENSOR` ✔; `Cabin.DoorCount.default == 4` ✔; tập key leaf đúng như Notes 2026-10-01 ✔.
- `vss_rel_4.2.json` (tag `v4.2` → commit `6024c4b2…`, asset sha256 `6de4edc9…e870e3`): 1 391 node = 322 branch / 484 actuator / 467 sensor / 118 attribute; 165 entry `deprecation`; chuỗi `Vehicle.Body.RefuelPosition.deprecation` khớp từng ký tự với mục Verification ✔. File **chưa có trong repo** ⇒ M02-T02 vendor vào `fixtures/vss/` kèm dòng PROVENANCE (seed LocalFile), không sửa nội dung.
- **Lệch §2 (`quantities.yaml`)**: v4.0 không có `quantities.yaml` (PROVENANCE đã ghi); v4.2 có `units.yaml` (sha256 `fd56ea38…`) và `quantities.yaml` (sha256 `312d4669…`) là release asset. ⇒ `units`/`quantities` là **tuỳ chọn theo release**; nguồn `LocalFile` khai báo file nào có, catalog không lỗi khi thiếu `quantities.yaml`.
- Port service: `:4010` (theo phase M02-T04), bind `127.0.0.1` khi publish (ADR-0005).

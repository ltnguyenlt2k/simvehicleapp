# ADR-0015: Hệ kiểu & đơn vị (theo VSS datatypes/units, conversion tường minh)

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L1
- **Related:** Master Plan 6.4, 6.5; [06 §5](../06-ir-and-compiler.md)

## Context
VSS 4.0 dùng: `boolean, double, float, int8, int16, int32, string, string[], uint8, uint16, uint32, uint8[]` (+ int64/uint64 trong spec). Units: `km/h, percent, celsius, V, A, kWh, mm, rpm, m/s^2, s…` với `quantities.yaml` mô tả dimension. Actuator hẹp (vd `uint8` percent 0–100) dễ bị ghi giá trị ngoài miền.

## Decision
1. Kiểu nguyên thuỷ = kiểu VSS; kiểu nội bộ thêm `duration(ms)`, `timestamp(ms)`, `json`.
2. **Suy luận biểu thức:** số học trên số → `double` nếu có float/double, ngược lại số nguyên rộng nhất có dấu; so sánh/logic → `boolean`; ternary → kiểu chung nhỏ nhất.
3. **Không cast ngầm thu hẹp.** Ghi `double` vào `uint8` ⇒ lỗi `TYPE_NARROWING_REQUIRES_CAST` với quick-fix chèn `Convert` (cast + clamp theo min/max VSS). Widening int→float tự động.
4. Enum string (`allowed`) là kiểu con: literal phải thuộc tập; expression string ghi vào enum ⇒ warning + runtime validate (từ chối ghi + log error).
5. **Unit:** mỗi giá trị mang unit (null = dimensionless). Cùng dimension khác unit ⇒ compiler chèn node `unit.convert` (hệ số từ bảng nội bộ, kiểm tra bằng test). Khác dimension ⇒ `UNIT_DIMENSION_MISMATCH`. Literal không unit được gán unit của vế kia (có info `UNIT_ASSUMED`).
6. Bảng unit/quantity nạp từ release VSS (`units.yaml`, `quantities.yaml`; v4.0 không đính kèm file units ⇒ dùng bản units.yaml của nhánh `release/4.0` seed sẵn).

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| "Best-effort cast" | Master Plan cấm; lỗi âm thầm trên xe |
| Bỏ unit | Mất kiểm tra quan trọng (km/h vs m/s) |

## Consequences
+ Bắt lỗi sớm, code sinh an toàn. − Người dùng thỉnh thoảng phải thêm Convert (có quick-fix).

## Implementation
`packages/types` + `packages/units` trong core (M4); quick-fix UI (M4).

## Mở rộng
Chi tiết kiểu mảng `T[]` (read-only trong UI, index/len/contains, diagnostic riêng) và mã hoá an toàn `int64`/`uint64` qua JSON (string, tránh mất chính xác > `Number.MAX_SAFE_INTEGER`): xem [ADR-0018](ADR-0018-vss-array-and-full-datatype-coverage.md) — quyết định đó mở rộng, không thay thế, các quy tắc ở trên.

## Verification
Bảng test ≥ 100 cặp phép toán/kiểu; unit conversion test với giá trị chuẩn (100 km/h = 27.7778 m/s).

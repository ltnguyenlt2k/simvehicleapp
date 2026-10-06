# ADR-0015: Hệ kiểu & đơn vị (theo VSS datatypes/units, conversion tường minh)

- **Status:** Proposed — triển khai M4 theo uỷ quyền PO 2026-10-06, **chờ PO chấp thuận** khi verify cuối · **Date:** 2026-09-30 · **Level:** L1
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

## Notes / Deviations
**2026-10-06 — rà soát trước M4:**
1. Nguồn bảng unit: v4.0 dùng `contracts/fixtures/vss/units.yaml` (seed từ nhánh `release/4.0`); v4.2 dùng `fixtures/vss/v4.2/{units,quantities}.yaml`. `packages/units` nạp theo release của workflow và gắn vào `modelHash`, nên đổi bảng ⇒ đổi hash.
2. Hệ số chuyển đổi **chỉ** lấy từ bảng nội bộ có test (100 km/h = 27.7778 m/s, °C↔°F/K có offset). Unit không có trong bảng nhưng cùng dimension ⇒ `UNIT_DIMENSION_MISMATCH` (không đoán).
3. Literal số không unit so với signal có unit ⇒ gán unit của vế kia + info `UNIT_ASSUMED`; `%` là unit `percent` (ADR-0013 Notes).
4. So sánh/ghi giá trị kiểu `string` có `allowed` (enum VSS): literal kiểm ở lint S3 (`ENUM_VALUE_NOT_ALLOWED`, đã có M3); biểu thức string ⇒ warning + runtime từ chối ghi.
5. **Mâu thuẫn đã giải quyết:** analysis/06 §5 (bản cũ) viết "compiler chèn `type.cast` với clamp" khi ghi double vào actuator hẹp, trái với Decision §3 ở đây. Decision §3 giữ nguyên, vì Master Plan cấm best-effort cast và clamp ngầm là lỗi âm thầm trên xe. analysis/06 đã sửa theo. Cast tường minh = block `sv_convert` (`to` = kiểu đích, clamp theo min/max VSS); quick-fix của `TYPE_NARROWING_REQUIRES_CAST` chèn block này.
6. **Literal số không cần Convert:** literal nguyên/thực nằm trong miền của kiểu đích (và min/max VSS) được nhận trực tiếp, ví dụ `80` → `uint8`, `0` → Window.Position. Ngoài miền ⇒ `VALUE_OUT_OF_RANGE` (lint M3). Chỉ biểu thức tính toán mới chịu quy tắc §3.
7. **Ngữ nghĩa số học chốt cho mọi backend (M04-T02, 2026-10-06)** — tài liệu cũ chưa định nghĩa `/`, `%`, tràn số, `+` chuỗi; C++ (chia nguyên cắt cụt, tràn có dấu là UB), Python (`%` theo floor) và simulator sẽ lệch nhau nếu không chốt:
   - Số nguyên mang **miền giá trị** `[min, max]` (kiểu VSS ⇒ miền đầy đủ; literal ⇒ một điểm). `+ − *` và `-` một ngôi trên số nguyên ⇒ `int64` với miền tính bằng số học khoảng; miền vượt int64 ⇒ `TYPE_MISMATCH` (`reason: integer_overflow`) — không bao giờ tràn lúc chạy, không UB.
   - Có `float`/`double` ⇒ `double`. Số nguyên có miền vượt ±2^53 (int64/uint64 VSS đầy đủ) trộn với số thực ⇒ `TYPE_MISMATCH` (`int64_precision`), phải Convert (khớp ADR-0018 §7).
   - `/` luôn ⇒ `double` (IEEE: chia 0 ⇒ ±Inf/NaN); `%` luôn ⇒ `double` theo `fmod` (dấu theo số bị chia). Không có chia nguyên.
   - Gán: số nguyên ⇒ số nguyên được khi miền nguồn ⊆ miền đích (literal `80` → `uint8` được; `<x.uint8> + 1` → `uint8` cần Convert); số thực ⇒ số nguyên luôn cần Convert (`TYPE_NARROWING_REQUIRES_CAST`); `double` ⇒ `float` được (làm tròn IEEE gần nhất, chỉ mất độ chính xác).
   - So sánh `== !=` trên cùng nhóm kiểu (số/chuỗi/boolean); `< <= > >=` chỉ trên số; `&& || !` chỉ trên boolean; `+` trên chuỗi ⇒ `TYPE_MISMATCH` (nối chuỗi dùng template). Ternary: hai nhánh cùng nhóm, số ⇒ kiểu chung.
   - `duration`/`timestamp` là ms nguyên: `timestamp − timestamp ⇒ duration`, `timestamp ± duration ⇒ timestamp`, `duration ± duration ⇒ duration`, `duration × số ⇒ duration`.
   - Hàm: `abs/min/max/clamp` giữ nhóm (nguyên ⇒ miền, thực ⇒ double); `round/floor/ceil/scale` ⇒ `double`; `in_range/contains` ⇒ boolean; `len` ⇒ `uint32`; `now_ms` ⇒ `timestamp`; `at`/index ⇒ kiểu phần tử.
   - Template nội suy số theo **dạng thập phân ngắn nhất khôi phục đúng giá trị của chính kiểu đó** (`float` 0.1 ⇒ "0.1"), boolean ⇒ `true`/`false`, mảng ⇒ JSON — mọi backend in giống nhau (M5/M6 kiểm parity).
8. **Quy đổi unit (M04-T02):** hệ số lưu dạng phân số chính xác; compiler gộp from→to thành `scale`, `offset` rồi làm tròn **một lần** sang double và ghi vào IR; backend tính `v * scale + offset` (C++ biên dịch với `-ffp-contract=off` để không gộp FMA ⇒ cùng bit với simulator/Python). Chỉ quy đổi trong cùng quantity VSS và chỉ giữa unit tuyến tính: `dB`/`dBm` (logarit), `months`/`years` (độ dài không cố định), `unix-time`/`iso8601` (khác biểu diễn) không quy đổi được (`UNIT_DIMENSION_MISMATCH`).

# ADR-0018: Bao phủ đầy đủ datatype VSS — bao gồm mảng (array) — từ UI → expression → IR → codegen → runtime

- **Status:** Proposed · **Date:** 2026-10-02 · **Level:** L1
- **Related:** FR-VSS-01, FR-BLK-01..04, NFR-05 (no silent data loss); mở rộng [ADR-0013](ADR-0013-dataflow-and-expression-language.md), [ADR-0015](ADR-0015-type-and-unit-system.md), [ADR-0016](ADR-0016-diagnostics-catalog.md), [ADR-0022](ADR-0022-cpp-codegen-strategy.md); [06 §4-5](../06-ir-and-compiler.md), [05](../05-blocks-and-execution-model.md)

## Context

PO yêu cầu (2026-10-02): một tín hiệu VSS có thể có nhiều **kiểu/miền giá trị** khác nhau; hệ thống — kể cả UI — phải phủ **toàn bộ** trường hợp này một cách rõ ràng để giữ đúng tinh thần no-code, và đảm bảo gen code/build/run xử lý đúng dữ liệu, đẩy đúng dữ liệu điều khiển.

Rà soát lại toàn bộ thiết kế hiện có (05, 06, ADR-0010/0013/0015/0022) phát hiện: `T[]` (mảng) **được nhắc tên** ở vài chỗ (node schema VSS, bảng kiểu C++) nhưng **chưa có thiết kế thật** — không có cú pháp mảng trong SVX, không có opcode/IR cho truy cập phần tử, không có block/UI nào thao tác giá trị mảng, không có diagnostic cho lỗi liên quan tới mảng, không có quy tắc codegen cho `std::vector<T>`. Đây là khoảng trống thật cần lấp, không phải chỉ "ghi chú thêm".

### Dữ kiện đã verify trực tiếp (2026-10-02)

1. **COVESA VSS rule_set/data_entry/data_types** định nghĩa đúng **12 kiểu vô hướng**: `uint8, int8, uint16, int16, uint32, int32, uint64, int64, boolean, float, double, string`. Mỗi kiểu có dạng mảng tương ứng `<type>[]` (ký hiệu `arraysize` cho mảng cố định độ dài tồn tại trong spec nhưng **0 lần xuất hiện** trong `vss_rel_4.0.json`/`vss_rel_4.2.json` thật — mảng trong thực tế luôn là độ dài biến đổi).
2. Quét toàn bộ `vss_rel_4.0.json` (1197 node) và `vss_rel_4.2.json`: kiểu mảng thực tế xuất hiện là `string[]`, `uint8[]` (v4.0) và thêm `float[]` (v4.2). **int64[]/uint64[]/boolean[] chưa xuất hiện trong data thật nhưng hợp lệ theo spec** — phải hỗ trợ đầy đủ, không chỉ hỗ trợ những gì đã thấy.
3. **Không có `actuator` nào mang kiểu mảng** trong cả hai bản VSS đã quét — **100% tín hiệu kiểu mảng là `sensor` hoặc `attribute`** (ví dụ `Vehicle.OBD.PidsA` string[], `Vehicle.Cabin.Infotainment.SmartphoneProjection.SupportedMode` string[] với `allowed`, `Vehicle.Cabin.SeatPosCount` uint8[] với `default`). ⇒ **Trong thực tế không có nhu cầu "ghi" một giá trị mảng vào xe** ở tầng ứng dụng no-code — chỉ cần **đọc**.
4. Không node mảng nào mang `min`/`max`/`unit` trong data thật; một số mang `allowed` (ý nghĩa: **mỗi phần tử** phải thuộc tập liệt kê, không phải cả mảng là 1 giá trị enum).
5. SDK C++ (`DataPoint.h`) và **SDK Python** (`velocitas_sdk/model.py`, verify qua wheel `velocitas-sdk==0.15.7`) **đều** định nghĩa đủ 12 cặp lớp `DataPoint<Type>` / `DataPoint<Type>Array` — không thiếu kiểu nào ở tầng SDK. Vậy phần thiếu hoàn toàn nằm ở tầng SimVehicle (UI/expression/IR/codegen), không phải giới hạn của Velocitas.
6. **Rủi ro mất độ chính xác int64/uint64 trong JSON**: `int64`/`uint64` có thể vượt `Number.MAX_SAFE_INTEGER` (2^53−1) của JavaScript/JSON — nếu WorkflowGraph/IR/scenario lưu giá trị 64-bit dưới dạng `number` JSON thuần, giá trị lớn sẽ **âm thầm sai số** khi đi qua Node.js/TypeScript (studio, core, orchestrator). Đây là rủi ro có thật, không lý thuyết (ví dụ các mốc thời gian epoch-nanosecond hoặc odometer-mm theo thời gian dài mà OEM overlay VSS có thể định nghĩa).

## Decision

### 1. Bảng kiểu đầy đủ (chốt danh sách, không mở rộng tuỳ tiện)
Kiểu vô hướng hợp lệ: `boolean, int8, int16, int32, int64, uint8, uint16, uint32, uint64, float, double, string`. Kiểu mảng hợp lệ: `<bất kỳ kiểu vô hướng nào>[]` (độ dài biến đổi, không hỗ trợ `arraysize` cố định ở v1 — chưa có nhu cầu thật). Kiểu nội bộ bổ sung (ngoài VSS): `duration(ms)`, `timestamp(ms)`, `json` (giữ như ADR-0015).

### 2. Mảng là **read-only** trong UI no-code v1 (khớp thực tế VSS)
- `sv_read_signal`/`sv_read_attribute` trên một path kiểu mảng cho **output kiểu `T[]`** — hiển thị bình thường như mọi output khác, badge kiểu trên block/toolbar hiện rõ `[ ]` (ví dụ "string[]").
- **`sv_set_actuator` không bao giờ nhận path kiểu mảng** làm input (vì không actuator nào là mảng trong thực tế) — nếu catalog phát hiện 1 actuator mảng xuất hiện ở VSS release tương lai, compiler **không cấm cứng bằng code** mà cấm bằng cùng cơ chế `VEHICLE_WRITE_READ_ONLY`/kiểm tra kiểu khớp; không cần block "Set array actuator" cho tới khi có nhu cầu thật (giữ nguyên tắc không xây tính năng chưa ai cần).
- Vì vậy **không cần UI nhập mảng dạng "list editor thêm từng dòng"** cho đường ghi (giảm đáng kể phạm vi UI phải làm ở M2/M3). Mảng chỉ cần nhập tay ở **Simulate/Scenario** (giá trị JSON array thuần, đã tự nhiên hỗ trợ vì scenario là JSON/YAML) và ở **Signals panel** khi dev muốn mock một giá trị mảng cho sensor/attribute lúc Live Run — xem §6.

### 3. Mở rộng SVX (sửa [ADR-0013](ADR-0013-dataflow-and-expression-language.md) §Grammar)
Thêm vào grammar hiện có (không phá cú pháp cũ):
```
primary  := number unit? | string | 'true' | 'false' | ref index? | call | '(' expr ')'
index    := '[' expr ']'                         // <PidsA.value>[0]
call     := ident '(' args ')'                   // + 3 hàm mới: len(arr) · contains(arr, literal) · at(arr, idx, default)
```
- `len(<Signal.value>)` → kiểu `uint32`, hoạt động trên bất kỳ giá trị `T[]`.
- `<Signal.value>[i]` (hoặc hàm tương đương `at(arr, i, default)` khi muốn có giá trị mặc định an toàn thay vì lỗi) → kiểu `T` (phần tử), `i` phải là biểu thức kiểu số nguyên.
- `contains(<Signal.value>, "01")` → kiểm tra 1 literal có nằm trong mảng không, trả `boolean`; dùng được cho cả kiểm tra `allowed`-membership lẫn tra cứu thông thường.
- **Giá trị kiểu mảng không được dùng trực tiếp** trong phép so sánh/số học/nối chuỗi vô hướng — phải qua `len`/index/`contains` trước. Vi phạm ⇒ diagnostic mới `ARRAY_VALUE_REQUIRES_INDEXING` (xem §4).
- Giới hạn an toàn: index là biểu thức bất kỳ (không bắt buộc hằng số) nhưng compiler **không** thể biết tĩnh index có nằm trong phạm vi hay không (độ dài mảng chỉ biết lúc chạy) ⇒ đây là lỗi **runtime**, không phải compile-time — xem §5.

### 4. IR & diagnostics mới (bổ sung [06 §2.2](../06-ir-and-compiler.md#22-bảng-opcode-v1-đầy-đủ) và [ADR-0016](ADR-0016-diagnostics-catalog.md))
- Opcode biểu thức mới trong `$expr`: `array.len`, `array.at` (`{value: $expr, index: $expr, default?: $expr}`), `array.contains`.
- Diagnostic mới (stage `types`): `ARRAY_VALUE_REQUIRES_INDEXING` (error — dùng mảng trực tiếp trong ngữ cảnh vô hướng), `ARRAY_INDEX_TYPE_INVALID` (error — index không phải kiểu số nguyên), `ARRAY_ELEMENT_TYPE_MISMATCH` (error — so sánh/gán phần tử mảng với kiểu không khớp datatype phần tử theo catalog).
- Diagnostic mới (runtime, không phải compile-time): `ARRAY_INDEX_OUT_OF_RANGE` — phát sinh ở **trace** (không chặn build), chính sách mặc định khi index vượt phạm vi: nếu dùng `at(arr, idx, default)` → trả `default` (không lỗi); nếu dùng cú pháp `arr[idx]` trần → ghi log lỗi + coi bước đó như nhánh `error` của node (theo đúng chính sách lỗi I/O chung ở [05 §3.6](../05-blocks-and-execution-model.md#36-lỗi-runtime)).

### 5. Block & UI mới (bổ sung [05 §2.4 Logic & Math](../05-blocks-and-execution-model.md#24-logic--math))
| Block `type` | Tên UI | Input | Output | Opcode |
|---|---|---|---|---|
| `sv_array_length` | Array Length | `array` (ref tới output kiểu `T[]`) | `length: uint32` | `array.len` |
| `sv_array_at` | Array Element At | `array`, `index: int32`, `default?` | `value: T` (suy theo kiểu phần tử của `array`) | `array.at` |
| `sv_array_contains` | Array Contains | `array`, `value` (literal/ref cùng kiểu phần tử) | `result: boolean` | `array.contains` |

- **Toolbar/catalog:** node VSS kiểu mảng hiện badge `[ ]` kèm kiểu phần tử (vd "string[]") trong panel Vehicle; tooltip liệt kê `allowed` nếu có (ví dụ danh sách PID hợp lệ) để người dùng hiểu rõ miền giá trị mà không cần đọc tài liệu VSS ngoài.
- **SubBlock `sv-typed-value`** (đã có ở ADR-0011 điểm 5): khi kiểu đích là mảng, **không** hiển thị input chỉnh sửa tay (vì không có actuator mảng) — chỉ hiển thị **read-only chip list** khi xem giá trị mẫu/kết quả Simulate.
- **Panel Simulate/Signals** (M5/M8): giá trị mảng hiển thị dạng chip "3 phần tử ▾" mở ra xem từng phần tử; ô "Inject giá trị" cho sensor/attribute mảng nhận **JSON array thuần** (textarea nhỏ, validate theo kiểu phần tử + `allowed` nếu có) — tái dùng engine validate đã có, không cần input "+ Thêm dòng" phức tạp.

### 6. Codegen C++ ([ADR-0022](ADR-0022-cpp-codegen-strategy.md) — bổ sung quy tắc)
- Kiểu VSS `T[]` ⇒ C++ `std::vector<CppType(T)>` (giữ nguyên ánh xạ đã có ở ADR-0022 điểm 2, nay có quy tắc cụ thể hoá).
- Đọc: `Vehicle.A.B.ArrSignal.get()->await().value()` trả thẳng `std::vector<T>` (SDK đã làm đúng việc này — xác nhận qua `DataPoint<Type>Array`), runtime wrap vào `Signal<std::vector<T>>` như mọi kiểu khác, không cần code đặc biệt ở tầng Runtime Library.
- `array.len` ⇒ sinh `static_cast<uint32_t>(vec.size())`.
- `array.at(arr, idx, default)` ⇒ sinh hàm inline bounds-checked (ví dụ `simvehicleapp::rt::arrayAt(vec, idx, default)` trong Runtime Library — **viết 1 lần trong runtime, không sinh lại logic bounds-check mỗi lần**, đúng nguyên tắc 3.4 của Master Plan): `idx` âm hoặc `>= vec.size()` ⇒ trả `default` (ghi trace `ARRAY_INDEX_OUT_OF_RANGE` ở mức `warn`) thay vì hành vi không xác định (UB) của `operator[]` trần — **không bao giờ sinh `vec[idx]` không kiểm tra biên**.
- `array.contains` ⇒ `std::find(vec.begin(), vec.end(), literal) != vec.end()`.
- **Không actuator mảng** ⇒ codegen **không cần** sinh nhánh `set()` cho kiểu mảng ở v1; nếu catalog tương lai có actuator mảng, backend trả lỗi `OPCODE_UNSUPPORTED_BY_BACKEND` cho tới khi có ADR bổ sung (nhất quán với nguyên tắc "không build tính năng chưa ai cần" ở §2).

### 7. int64/uint64 — mã hoá an toàn qua JSON (mới, chưa từng ghi ở đâu)
- Trong **WorkflowGraph**, **IR**, **Scenario**, và mọi JSON trao đổi giữa service TypeScript: giá trị hằng số/đã đọc của kiểu `int64`/`uint64` (và phần tử mảng cùng kiểu) **PHẢI** mã hoá dưới dạng **chuỗi thập phân** (`"123456789012345678"`), **không** dùng JSON `number` thuần — tránh mất chính xác khi vượt `Number.MAX_SAFE_INTEGER`. Node/TS dùng `BigInt` khi cần tính toán (SVX typer coi `int64`/`uint64` không tham gia phép toán số học trộn với `float`/`double` mà không qua `Convert` tường minh — nhất quán với quy tắc "không cast ngầm thu hẹp" của ADR-0015).
- C++ dùng `int64_t`/`uint64_t` nguyên bản (không có vấn đề độ chính xác ở tầng này).
- Đây là field hợp lệ theo spec nhưng **chưa có ví dụ thật trong VSS 4.0/4.2** — bắt buộc viết test với giá trị giả lập lớn (vd `9223372036854775000`) để chứng minh không mất chính xác qua toàn bộ pipeline, dù chưa có path VSS thật nào dùng tới.

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| Cho phép set actuator mảng + UI "list editor thêm dòng" ngay từ v1 | Không có nhu cầu thật (0/1197+ node VSS là actuator mảng); tốn công UI cho trường hợp chưa xảy ra |
| Biểu diễn mảng bằng chuỗi CSV thay vì JSON array trong scenario | JSON array tự nhiên hơn, không cần parser riêng, đã khớp định dạng `allowed`/`default` thật của VSS JSON |
| Bỏ qua int64/uint64 vì chưa có path thật dùng | Rủi ro âm thầm mất dữ liệu khi OEM overlay hoặc VSS bản sau thêm path 64-bit; chi phí làm đúng ngay từ đầu (string-encode) thấp hơn nhiều chi phí sửa sau khi đã có dữ liệu thật chạy sai |
| Cho phép `vec[idx]` sinh thẳng `operator[]` của `std::vector`, không bounds-check | Undefined behavior khi vượt biên — vi phạm an toàn; chi phí bounds-check không đáng kể |

## Consequences
+ Phủ đúng 100% kiểu dữ liệu VSS thật đã verify, không có "lỗ hổng âm thầm" khi gặp tín hiệu mảng hay 64-bit. + Phạm vi UI thực tế **nhỏ hơn** lo ngại ban đầu vì mảng luôn read-only.
− Thêm 3 block mới, 1 phần ngữ pháp mới trong SVX, 1 hàm runtime (`arrayAt`) phải viết và test kỹ ở M6.

## Implementation
| Task | Module | Milestone |
|---|---|---|
| Cập nhật `packages/types` (core): thêm `T[]`, quy tắc "mảng không dùng trực tiếp trong scalar context", mã hoá int64/uint64 dạng string | core | M3/M4 |
| SVX: cú pháp `ref[expr]`, hàm `len/at/contains` | core/packages/expr | M3 |
| 3 diagnostic compile-time + 1 diagnostic runtime mới | core, contracts | M3/M4 |
| 3 block mới (`sv_array_length/at/contains`) + badge `[ ]` trên toolbar + chip-list ở Simulate/Signals | studio, core | M3, M5, M8 |
| Runtime C++: `rt::arrayAt`, test bounds-check | compiler-code-cpp | M6 |
| Test int64/uint64 string-encode xuyên suốt pipeline (giá trị giả lập lớn) | core, contracts | M4 |

## Verification
- Golden test VSS thật: đọc `Vehicle.OBD.PidsA` (string[]), kiểm `len(...) == 32`, `contains(..., "01") == true`, `at(..., 99, "N/A") == "N/A"` (vượt biên, không lỗi).
- Test cố ý sai: dùng `<PidsA.value> == "01"` (so sánh mảng trực tiếp) ⇒ đúng mã `ARRAY_VALUE_REQUIRES_INDEXING`.
- Test giá trị `int64` giả lập `9223372036854775000` đi hết WorkflowGraph → IR → Scenario → C++ build → runtime, so sánh bit-exact ở hai đầu.
- Build thật C++ cho GW mở rộng dùng `sv_array_length`/`sv_array_at` trên `Vehicle.OBD.PidsA` — binary không crash khi index vượt biên (test bằng giá trị index runtime lớn hơn độ dài mảng thật).

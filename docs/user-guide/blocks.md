# Tham chiếu khối (block reference)

> Sinh tự động từ `modules/simvehicleapp-core/packages/blocks/*/spec.json` và `semantics.md` bởi
> `scripts/docs/gen_block_reference.py` — không sửa tay. Hướng dẫn bắt đầu: [tutorial.md](tutorial.md).

36 khối. Biểu thức (`expression`) dùng cú pháp SVX: tham chiếu `<tênkhối.output>` hoặc `<Vehicle.Đường.Dẫn>`,
toán tử ASCII (`== != < <= > >= && || !`), chuỗi trong nháy kép. `template` là văn bản có thể chèn tham chiếu `<…>`.

## Triggers

### When app starts — `sv_on_app_start`

opcode `event.app_start` · phiên bản 1 · vào [—] · ra [source]

- **Loại:** trigger; opcode `event.app_start`; không prop, không output; handle ra `source`.
- **Ngữ nghĩa:** bắn **đúng một lần** khi app vehicle khởi động xong (đã kết nối databroker, attribute đã đọc cache). Không có chính sách đồng thời (chỉ một lần).
- **Thay vai trò block Start của Sim** cho workflow vehicle (ADR-0012 Notes 2026-10-04).
- **Edge case:** nhiều block `sv_on_app_start` trong một workflow ⇒ mỗi block tạo một run riêng, thứ tự theo `seq` (ADR-0012 §5).

### When condition becomes true — `sv_on_condition`

opcode `event.condition` · phiên bản 1 · vào [—] · ra [source]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `expr` | expression | có |  |  |
| `debounceMs` | duration |  | 0 |  |
| `concurrency` | enum |  | "restart" | "restart", "ignore", "queue", "parallel" |

Đầu ra: `timestamp` (timestamp)

- **Loại:** trigger; opcode `event.condition`; handle ra `source`.
- **`expr`:** biểu thức boolean SVX tham chiếu signal (`<Vehicle.…>`) hoặc biến; runtime tự subscribe mọi signal trong biểu thức.
- **Bắn theo cạnh lên:** khi giá trị đổi false → true (không bắn lại khi vẫn true). **`debounceMs`:** điều kiện phải giữ true đủ lâu.
- **`concurrency`:** mặc định `restart`. **Output:** `timestamp`.
- **Lỗi:** biểu thức không boolean ⇒ `TYPE_MISMATCH` (M4).

### When MQTT message — `sv_on_mqtt`

opcode `event.mqtt_message` · phiên bản 1 · vào [—] · ra [source]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `topic` | string | có |  |  |
| `payloadType` | enum |  | "text" | "text", "json" |
| `concurrency` | enum |  | "queue" | "restart", "ignore", "queue", "parallel" |

Đầu ra: `payload` ($inferred), `topic` (string)

- **Loại:** trigger; opcode `event.mqtt_message`; handle ra `source`.
- **`topic`:** topic hoặc filter (`+`, `#`) trên broker của runtime. **`payloadType`:** `text` (mặc định) hoặc `json` (parse; payload lỗi ⇒ log, không bắn).
- **`concurrency`:** mặc định `queue` (xử lý tuần tự, tối đa 8, tràn ⇒ bỏ cũ nhất + trace).
- **Outputs:** `payload` (string hoặc json theo `payloadType`), `topic` (topic thật của message).

### When signal changes — `sv_on_signal_changed`

opcode `event.signal_changed` · phiên bản 1 · vào [—] · ra [source]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `path` | vss-path | có |  |  |
| `mode` | enum | có | "any" | "any", "rising", "falling", "crosses_above", "crosses_below", "becomes" |
| `threshold` | typed-value |  |  |  |
| `debounceMs` | duration |  | 0 |  |
| `concurrency` | enum |  | "restart" | "restart", "ignore", "queue", "parallel" |

Đầu ra: `value` ($signal), `previous` ($signal), `timestamp` (timestamp)

- **Loại:** trigger (category `triggers`) ⇒ không có handle vào; một handle ra `source` bắt đầu chuỗi bước của run.
- **Opcode:** `event.signal_changed` (args `signal`, `mode`, `threshold?`, `debounceMs`).
- **`path`:** VSS path kiểu `sensor` hoặc `actuator` (attribute không đổi lúc chạy ⇒ không cho chọn). Path mảng (`T[]`) được phép; chỉ `mode = any` có nghĩa với mảng (so sánh cả mảng).
- **`mode`:**
  - `any` (mặc định): bắn khi giá trị mới ≠ giá trị trước.
  - `rising` / `falling`: chỉ kiểu số hoặc boolean; bắn khi giá trị tăng / giảm (boolean: false→true / true→false).
  - `crosses_above` / `crosses_below`: chỉ kiểu số, cần `threshold`; bắn khi `previous ≤ threshold < value` / `previous ≥ threshold > value`.
  - `becomes`: cần `threshold` (cùng kiểu với signal, enum lấy từ `allowed`); bắn khi `value == threshold` và `previous != threshold`.
- **`threshold`:** giá trị cùng datatype với signal (`$signal`); int64/uint64 là chuỗi thập phân (ADR-0018 §7). Thiếu khi `mode` cần ⇒ lỗi compile (diagnostic ở M4).
- **`debounceMs`:** ≥ 0; > 0 ⇒ chỉ bắn khi điều kiện vẫn đúng sau khoảng thời gian này (đồng hồ đơn điệu; simulator dùng virtual clock).
- **`concurrency`:** `restart` mặc định (huỷ run cũ đang chờ, tạo run mới); `ignore`; `queue` (`queueMax` 8, tràn ⇒ bỏ sự kiện **cũ nhất** đang chờ + trace); `parallel` (`maxRuns` 4, vượt ⇒ bỏ sự kiện **mới**) — 05 §3.2, conformance C09–C14.
- **Outputs:** `value`, `previous` (cùng kiểu/đơn vị signal), `timestamp` (ms).
- **Mốc ban đầu (ADR-0012 Notes 2026-10-04):** giá trị signal đã có khi app khởi động (databroker trả khi subscribe) là mốc, **không** bắn. Signal chưa có giá trị ⇒ giá trị đầu tiên được publish bắn ở `mode = any` với `previous` = `value`. Conformance C08.
- **Side-effect:** subscribe signal trên databroker; không ghi gì.
- **Edge case:** mất kết nối databroker ⇒ không bắn, runtime tự reconnect (05 §3.6); giá trị không đổi ⇒ không bắn ở mọi mode.

### Every … — `sv_on_timer`

opcode `event.timer` · phiên bản 1 · vào [—] · ra [source]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `intervalMs` | duration | có |  |  |
| `initialDelayMs` | duration |  | 0 |  |
| `concurrency` | enum |  | "ignore" | "restart", "ignore", "queue", "parallel" |

Đầu ra: `tick` (uint32), `timestamp` (timestamp)

- **Loại:** trigger; opcode `event.timer`; handle ra `source`.
- **`intervalMs`:** chu kỳ, ≥ 10 ms (bắt buộc). **`initialDelayMs`:** tick đầu tiên tại `initialDelayMs` (mặc định 0 = ngay khi app chạy), sau đó mỗi `intervalMs` (conformance C15).
- **`concurrency`:** mặc định `ignore` (bỏ tick khi run trước chưa xong); `restart`/`queue`/`parallel` theo 05 §3.2.
- **Outputs:** `tick` (đếm từ 1, uint32), `timestamp` (ms, đồng hồ đơn điệu; simulator dùng virtual clock).
- **Thời gian:** tick theo lịch cố định (không trôi theo thời gian chạy run); tick trễ quá một chu kỳ ⇒ bỏ, không dồn.

## Sensors

### Read signal — `sv_read_signal`

opcode `vehicle.read` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `path` | vss-path | có |  |  |
| `source` | enum |  | "latest-from-trigger" | "latest-from-trigger", "fresh-read" |

Đầu ra: `value` ($signal), `timestamp` (timestamp)

- **Loại:** bước (category `sensors`); handle vào `target`, ra `source` (thành công) và `error`.
- **Opcode:** `vehicle.read` (args `signal`, `fresh`).
- **`path`:** `sensor` hoặc `actuator` (đọc giá trị hiện tại của actuator là hợp lệ). Path mảng cho output `value` kiểu `T[]` (chỉ đọc; dùng block `sv_array_*` để lấy phần tử).
- **`source`:**
  - `latest-from-trigger` (mặc định) ⇒ `fresh = false`: lấy giá trị mới nhất runtime đã biết (cache từ subscription), không yield. Compiler tự thêm subscription cache-only nếu path chưa được subscribe.
  - `fresh-read` ⇒ `fresh = true`: gọi databroker, là **yield point**; timeout mặc định 2000 ms ⇒ handle `error`.
- **Outputs:** `value` (kiểu/đơn vị signal), `timestamp` (ms, thời điểm giá trị được databroker ghi nhận).
- **Lỗi:** chưa có giá trị (signal chưa từng được publish), timeout, NOT_FOUND/ACCESS_DENIED ⇒ handle `error`; không nối nhánh lỗi ⇒ log + tiếp tục (05 §3.6).
- **Side-effect:** không.

## Actuators

### Set actuator — `sv_set_actuator`

opcode `vehicle.write` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `path` | vss-path | có |  |  |
| `value` | expression | có |  |  |
| `awaitAck` | boolean |  | true |  |
| `onError` | enum |  | "continue" | "continue", "stop" |

Đầu ra: `ok` (boolean), `error` (string)

- **Loại:** bước (category `actuators`); handle vào `target`, ra `source` (ghi thành công) và `error`.
- **Opcode:** `vehicle.write` (args `signal`, `value`).
- **`path`:** chỉ `actuator`, và **không** được là kiểu mảng (ADR-0018 §2 — không có actuator mảng trong VSS 4.0/4.2). Chọn sensor/attribute ⇒ lỗi compile `VEHICLE_WRITE_READ_ONLY`.
- **`value`:** biểu thức kiểu `$signal`; enum (`allowed`) ⇒ dropdown; giá trị phải nằm trong `[min, max]` / `allowed` của catalog (kiểm tĩnh nếu là hằng, ngoài ra kiểm lúc chạy). int64/uint64 là chuỗi thập phân trong JSON.
- **`awaitAck`** (mặc định `true`): chờ databroker xác nhận ⇒ **yield point**; `false` ⇒ gửi rồi đi tiếp ngay (lỗi chỉ được log).
- **`onError`** (mặc định `continue`): khi ghi lỗi mà handle `error` không được nối — `continue` = log + đi tiếp qua `source`; `stop` = dừng run.
- **Outputs:** `ok` (boolean), `error` (chuỗi mô tả lỗi, rỗng khi ok).
- **Lỗi:** UNAVAILABLE / NOT_FOUND / ACCESS_DENIED / giá trị ngoài miền ⇒ handle `error`.
- **Side-effect:** ghi target value của actuator trên databroker (KUKSA); không bao giờ ghi giá trị cảm biến.

## Attributes

### Read attribute — `sv_read_attribute`

opcode `vehicle.read_attribute` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `path` | vss-path | có |  |  |

Đầu ra: `value` ($signal)

- **Loại:** bước (category `attributes`); handle vào `target`, ra `source` và `error`.
- **Opcode:** `vehicle.read_attribute` (arg `signal`).
- **`path`:** chỉ `attribute` (giá trị tĩnh của xe, ví dụ `Vehicle.VehicleIdentification.VIN`, `Vehicle.Cabin.DoorCount`).
- **Ngữ nghĩa:** runtime đọc attribute **một lần khi app khởi động** và cache; block trả giá trị cache, không yield.
- **Outputs:** `value` (kiểu/đơn vị attribute; mảng ⇒ `T[]`, ví dụ `Vehicle.Cabin.SeatPosCount` uint8[]).
- **Lỗi:** attribute không có giá trị trên databroker (không có `default` và chưa được provider ghi) ⇒ handle `error`.
  *Lệch so với bảng opcode [06 §2.2](../../analysis/06-ir-and-compiler.md#22-bảng-opcode-v1-đầy-đủ) (chỉ ghi output `value`):* thêm handle `error` vì canvas Sim luôn vẽ handle `error` cho block không phải trigger và vì trường hợp "chưa có giá trị" là có thật — ghi ở Notes ADR-0011.
- **Side-effect:** không.

## Logic

### Array element at — `sv_array_at`

opcode `expr` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `array` | expression | có |  |  |
| `index` | expression | có |  |  |
| `default` | expression |  |  |  |

Đầu ra: `value` ($element)

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`array`:** biểu thức `T[]`; **`index`:** biểu thức số nguyên (int32; không nguyên ⇒ `ARRAY_INDEX_TYPE_INVALID`); **`default`** (tuỳ chọn): giá trị khi index ngoài phạm vi.
- **Output:** `value` kiểu phần tử `T` (opcode IR `array.at`).
- **Ngoài phạm vi (runtime):** có `default` ⇒ trả `default` + trace `ARRAY_INDEX_OUT_OF_RANGE` mức warn; không có ⇒ nhánh `error` của bước. Không bao giờ truy cập ngoài biên.

### Array contains — `sv_array_contains`

opcode `expr` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `array` | expression | có |  |  |
| `value` | expression | có |  |  |

Đầu ra: `result` (boolean)

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`array`:** biểu thức `T[]`; **`value`:** literal/ref cùng kiểu phần tử (khác ⇒ `ARRAY_ELEMENT_TYPE_MISMATCH`).
- **Output:** `result` boolean (opcode IR `array.contains`).

### Array length — `sv_array_length`

opcode `expr` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `array` | expression | có |  |  |

Đầu ra: `length` (uint32)

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`array`:** biểu thức kiểu `T[]` (vd `<Vehicle.OBD.PidsA>`). Không phải mảng ⇒ `TYPE_MISMATCH`.
- **Output:** `length` uint32 (opcode IR `array.len`, gộp vào biểu thức).

### And / Or / Not / Xor — `sv_bool`

opcode `expr` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `op` | enum | có | "and" | "and", "or", "not", "xor" |
| `inputs` | list | có |  |  |

Đầu ra: `result` (boolean)

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`op`:** `and` (mặc định), `or`, `not`, `xor`. **`inputs`:** danh sách biểu thức boolean (`not` dùng đúng 1 phần tử; `xor` = số phần tử true là lẻ).
- **Output:** `result` boolean. `and`/`or` đánh giá ngắn mạch theo thứ tự danh sách.
- **Lỗi:** phần tử không boolean ⇒ `TYPE_MISMATCH` (M4).

### Clamp — `sv_clamp`

opcode `expr` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `value` | expression | có |  |  |
| `min` | expression | có |  |  |
| `max` | expression | có |  |  |

Đầu ra: `result` ($inferred)

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`value`, `min`, `max`:** biểu thức cùng kiểu số; tương đương SVX `clamp(value, min, max)`.
- **Output:** `result` cùng kiểu với `value`. `min > max` là hằng ⇒ lỗi cấu hình.

### Compare — `sv_compare`

opcode `expr` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `left` | expression | có |  |  |
| `op` | enum | có | ">" | ">", "<", ">=", "<=", "==", "!=" |
| `right` | expression | có |  |  |

Đầu ra: `result` (boolean)

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`left`, `right`:** biểu thức; **`op`:** `>` `<` `>=` `<=` `==` `!=` (mặc định `>`). Tương đương SVX `left op right`.
- **Output:** `result` boolean.
- **Kiểu/đơn vị:** khác kiểu không so sánh được ⇒ `TYPE_MISMATCH`; cùng dimension khác đơn vị ⇒ compiler chèn đổi đơn vị; khác dimension ⇒ `UNIT_DIMENSION_MISMATCH` (M4). Mảng phải qua `len`/`at`/`contains` ⇒ `ARRAY_VALUE_REQUIRES_INDEXING`.

### Constant — `sv_constant`

opcode `const` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `type` | enum | có | "float" | "boolean", "int8", "int16", "int32", "int64", "uint8", "uint16", "uint32", "uint64", "float", "double", "string" |
| `value` | typed-value | có |  |  |

Đầu ra: `value` ($inferred)

- **Loại:** bước (category `logic`), opcode `const`: giá trị literal, compiler nhúng thẳng vào chỗ dùng; handle `target`/`source`/`error` như mọi bước.
- **`type`:** một trong 12 kiểu vô hướng VSS (mặc định `float`). **`value`:** literal kiểm theo `type` (int64/uint64 là chuỗi thập phân, ADR-0018 §7).
- **Output:** `value` có kiểu = `type`.

### Convert unit/type — `sv_convert`

opcode `expr` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `value` | expression | có |  |  |
| `to` | string | có |  |  |

Đầu ra: `result` ($inferred)

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`value`:** biểu thức; **`to`:** đơn vị VSS đích (vd `m/s`, `kPa`) hoặc kiểu đích (vd `uint8`). Số thực ⇒ số nguyên: làm tròn gần nhất (0,5 ra xa 0), `NaN` ⇒ 0, rồi kẹp vào miền kiểu đích (và min/max VSS khi ghi) — giống nhau ở mọi backend (ADR-0014 Notes §11).
- **Đổi đơn vị:** chỉ trong cùng dimension (bảng `units.yaml`/`quantities.yaml` của release); khác dimension ⇒ `UNIT_DIMENSION_MISMATCH`.
- **Đổi kiểu thu hẹp:** tường minh, có kẹp miền; đây là cách người dùng xử lý `TYPE_NARROWING_REQUIRES_CAST`.
- **Output:** `result` có kiểu/đơn vị đích.

### Expression — `sv_expression`

opcode `expr` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `expr` | expression | có |  |  |

Đầu ra: `result` ($inferred)

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`expr`:** biểu thức SVX đầy đủ (toán tử, hàm whitelist, template, tham chiếu `<…>`).
- **Output:** `result` — kiểu do typer suy ra (ADR-0015, M4).
- **Lỗi (lint/compile):** cú pháp ⇒ `EXPR_SYNTAX`; hàm lạ ⇒ `EXPR_UNKNOWN_FUNCTION`; tham chiếu không tồn tại ⇒ `EXPR_UNKNOWN_REF`; tham chiếu block chưa chắc chạy trước ⇒ `DATA_REF_NOT_DOMINATING`.

### In range / Hysteresis — `sv_in_range`

opcode `logic.in_range` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `value` | expression | có |  |  |
| `low` | expression | có |  |  |
| `high` | expression | có |  |  |
| `mode` | enum |  | "range" | "range", "hysteresis" |

Đầu ra: `result` (boolean), `state` (boolean)

- **Loại:** bước có **state** (category `logic`), opcode `logic.in_range` — không gộp được vào biểu thức vì mode hysteresis nhớ trạng thái giữa các lần chạy; handle `target`/`source`/`error`.
- **`value`, `low`, `high`:** biểu thức số. **`mode`:** `range` (mặc định) ⇒ `result = low ≤ value ≤ high`, không state; `hysteresis` ⇒ `state` bật khi `value ≥ high`, tắt khi `value ≤ low`, giữ nguyên giữa hai ngưỡng.
- **Outputs:** `result` boolean, `state` boolean (trạng thái hysteresis; bằng `result` ở mode `range`).
- **State** gắn với block (không theo run), khởi tạo false khi app chạy.

### Lookup table — `sv_lookup`

opcode `expr` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `value` | expression | có |  |  |
| `table` | list | có |  |  |
| `default` | expression | có |  |  |

Đầu ra: `result` ($inferred)

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`value`:** biểu thức; **`table`:** danh sách `{when, then}` duyệt theo thứ tự, dòng đầu có `when == value` thắng; **`default`:** kết quả khi không dòng nào khớp.
- **Output:** `result` — kiểu chung của các `then` và `default` (khác kiểu ⇒ `TYPE_MISMATCH`, M4).

### Math — `sv_math`

opcode `expr` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `op` | enum | có | "+" | "+", "-", "*", "/", "%", "min", "max", "abs", "round", "floor", "ceil" |
| `a` | expression | có |  |  |
| `b` | expression |  |  |  |

Đầu ra: `result` ($inferred)

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`op`:** `+ - * / %`, `min`, `max` (dùng `a` và `b`), `abs`, `round`, `floor`, `ceil` (chỉ `a`). Mặc định `+`.
- **`a`, `b`:** biểu thức số; `b` bắt buộc với toán tử hai ngôi (kiểm ở compiler).
- **Output:** `result` — kiểu suy luận (ADR-0015 Notes §7): `+ − ×` trên số nguyên ⇒ `int64` với miền tính được (miền vượt int64 ⇒ `TYPE_MISMATCH`, không bao giờ tràn lúc chạy); có float/double ⇒ `double`; `/` và `%` luôn ⇒ `double`.
- **Edge case:** `/` và `%` tính trên double theo IEEE-754 (`%` = `fmod`, dấu theo số bị chia): chia/mod cho 0 ⇒ ±Inf/NaN, giống nhau ở mọi backend (không có chia nguyên nên không có UB). *(Sửa 2026-10-06: bản trước ghi "chia nguyên cho 0 ⇒ nhánh error", trái ADR-0015 Notes §7.)*

### Map range — `sv_scale`

opcode `expr` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `value` | expression | có |  |  |
| `inMin` | number | có |  |  |
| `inMax` | number | có |  |  |
| `outMin` | number | có |  |  |
| `outMax` | number | có |  |  |
| `clamp` | boolean |  | true |  |

Đầu ra: `result` (double)

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`value`:** biểu thức số; **`inMin`, `inMax`, `outMin`, `outMax`:** số; **`clamp`** (mặc định true): kẹp kết quả trong `[outMin, outMax]`.
- **Output:** `result` double = `outMin + (value − inMin) × (outMax − outMin) / (inMax − inMin)` (tương đương hàm SVX `scale`).
- **Edge case:** `inMin == inMax` ⇒ lỗi cấu hình (compile).

## Flow

### If / Else — `sv_if`

opcode `control.branch` · phiên bản 1 · vào [target] · ra [then, else]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `condition` | expression | có |  |  |

- **Opcode:** `control.branch`. Handle vào `target`; ra `then` (điều kiện true) và `else` (false). Không yield.
- **`condition`:** biểu thức boolean (không boolean ⇒ `TYPE_MISMATCH`, M4).
- Nhánh không nối ⇒ run kết thúc ở nhánh đó. Nối handle không tồn tại ⇒ `HANDLE_UNKNOWN`.

### Run in parallel — `sv_parallel`

opcode `control.parallel` · phiên bản 1 · vào [target] · ra [parallel-start-source, parallel-end-source]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `join` | enum |  | "all" | "all", "any", "none" |

- **Opcode:** `control.parallel` (+ join); container subflow `parallel` của Sim. Handle vào `target`; ra `parallel-start-source` (các nhánh) và `parallel-end-source` (sau join).
- **`join`:** `all` (mặc định, chờ mọi nhánh), `any` (nhánh đầu xong thì đi tiếp, huỷ các nhánh còn lại), `none` (đi tiếp ngay, nhánh chạy nền).
- "Song song" là xen kẽ trên **một strand** (ADR-0012 §2), không đa luồng. Không có nhánh ⇒ `PARALLEL_BRANCH_EMPTY`.

### Repeat — `sv_repeat`

opcode `control.repeat` · phiên bản 1 · vào [target] · ra [loop-start-source, loop-end-source]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `count` | integer | có |  |  |
| `intervalMs` | duration |  | 0 |  |

Đầu ra: `index` (uint32)

- **Opcode:** `control.repeat`; container dùng subflow `loop` của Sim (M03-T10). Handle vào `target`; ra `loop-start-source` (thân vòng lặp) và `loop-end-source` (đi tiếp sau vòng cuối).
- **`count`:** 1…10 000; **`intervalMs`:** nghỉ giữa các vòng (mặc định 0). Mỗi vòng là **yield point** (ADR-0012 §3).
- **Output:** `index` (0-based, uint32), đọc trong thân bằng `<loop.index>`.
- Thân rỗng/không hợp lệ ⇒ `CONTAINER_INVALID`.

### Stable for — `sv_stable_for`

opcode `control.stable_for` · phiên bản 1 · vào [target] · ra [stable, broken]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `condition` | expression |  |  |  |
| `durationMs` | duration | có |  |  |

- **Opcode:** `control.stable_for`; yield point. Handle vào `target`; ra `stable` (giữ đủ `durationMs`) và `broken` (bị phá trước hạn; tuỳ chọn nối).
- **`condition`:** biểu thức boolean; bỏ trống ⇒ "giá trị trigger không đổi" (giá trị của trigger mở run này).
- **`durationMs`:** ≥ 1. Kết hợp trigger `restart` cho mẫu "stable overspeed" (05 §3.2).

### Stop — `sv_stop`

opcode `control.stop` · phiên bản 1 · vào [target] · ra [—]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `scope` | enum |  | "run" | "run", "workflow", "app" |

- **Opcode:** `control.stop`. Handle vào `target`; **không** có handle ra.
- **`scope`:** `run` (mặc định, kết thúc run hiện tại), `workflow` (huỷ mọi run của workflow), `app` (dừng app). Huỷ qua cancel token: mọi timer/continuation của phạm vi bị huỷ (ADR-0012 §6).

### Switch — `sv_switch`

opcode `control.switch` · phiên bản 1 · vào [target] · ra [case, default]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `value` | expression | có |  |  |
| `cases` | list | có |  |  |

- **Opcode:** `control.switch`. Handle vào `target`; ra **họ handle `case`** = `case-<i>` (i = vị trí trong `cases`, từ 0) và `default`.
- **`value`:** biểu thức; **`cases`:** danh sách `{when}` (literal/biểu thức cùng kiểu `value`), so khớp theo thứ tự, case đầu khớp thắng; không case nào khớp ⇒ `default`.
- `when` lặp lại ⇒ case sau không bao giờ chạy (lint cảnh báo); giá trị enum ngoài `allowed` ⇒ `ENUM_VALUE_NOT_ALLOWED`.

### Wait — `sv_wait`

opcode `control.wait` · phiên bản 1 · vào [target] · ra [source]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `durationMs` | duration | có |  |  |

- **Opcode:** `control.wait`; **yield point** (ADR-0012 §3). Handle vào `target`, ra `source` (đi tiếp sau khi chờ). Không có nhánh lỗi.
- **`durationMs`:** ≥ 0 (0 = nhường lượt rồi đi tiếp). Run bị huỷ (policy `restart`, stop) ⇒ timer bị huỷ theo cancel token.

### Wait until — `sv_wait_until`

opcode `control.wait_until` · phiên bản 1 · vào [target] · ra [ok, timeout]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `condition` | expression | có |  |  |
| `timeoutMs` | duration | có |  |  |

- **Opcode:** `control.wait_until`; yield point. Handle vào `target`; ra `ok` (điều kiện thành true) và `timeout`.
- **`condition`:** biểu thức boolean, đánh giá lại khi signal/biến trong đó đổi (runtime subscribe), và ngay khi vào block (đã true ⇒ `ok` ngay).
- **`timeoutMs`:** ≥ 1, bắt buộc (không chờ vô hạn).

### While — `sv_while`

opcode `control.while` · phiên bản 1 · vào [target] · ra [loop-start-source, loop-end-source]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `condition` | expression | có |  |  |
| `maxIterations` | integer | có | 1000 |  |
| `intervalMs` | duration |  | 0 |  |

Đầu ra: `index` (uint32)

- **Opcode:** `control.while`; container subflow `loop` của Sim. Handle vào `target`; ra `loop-start-source` (thân) và `loop-end-source` (khi điều kiện false).
- **`condition`:** boolean, kiểm trước mỗi vòng. **`maxIterations`:** bắt buộc (mặc định 1 000; thiếu ⇒ `LOOP_GUARD_MISSING`); vượt ⇒ dừng run + trace. **`intervalMs`:** nghỉ giữa vòng; mỗi vòng là yield point.
- **Output:** `index` (`<loop.index>`).

## State

### Counter — `sv_counter`

opcode `state.counter` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `name` | string | có |  |  |
| `op` | enum |  | "inc" | "inc", "dec", "reset" |
| `step` | integer |  | 1 |  |

Đầu ra: `value` (int32)

- **Opcode:** `state.counter`. Bước thường, không yield.
- **`name`:** biến số nguyên đã khai báo; **`op`:** `inc` (mặc định), `dec`, `reset` (về giá trị đầu); **`step`:** ≥ 1 (mặc định 1).
- **Output:** `value` sau thao tác (int32); tràn miền ⇒ kẹp + `VALUE_OUT_OF_RANGE` ở trace.

### Get variable — `sv_var_get`

opcode `state.get` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `name` | string | có |  |  |

Đầu ra: `value` ($inferred)

- **Opcode:** `state.get`. Bước thường: handle `target` → `source`/`error`. Không yield.
- **`name`:** biến khai báo ở panel Variables (M03-T09) với kiểu + giá trị đầu; không có ⇒ `EXPR_UNKNOWN_REF`.
- **Output:** `value` (kiểu của biến). Tương đương tham chiếu `<variable.name>` trong biểu thức.

### Set variable — `sv_var_set`

opcode `state.set` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `name` | string | có |  |  |
| `value` | expression | có |  |  |

- **Opcode:** `state.set`. Bước thường, không yield; ghi nguyên tử trên strand.
- **`name`:** biến đã khai báo; **`value`:** biểu thức cùng kiểu biến (khác ⇒ `TYPE_MISMATCH`; thu hẹp ⇒ `TYPE_NARROWING_REQUIRES_CAST`).
- Biến thuộc **app** (dùng chung giữa các run), khởi tạo bằng giá trị đầu khi app chạy.

## Comm

### HMI notification — `sv_hmi_notify`

opcode `comm.hmi_notify` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `severity` | enum |  | "info" | "info", "warning", "critical" |
| `title` | template | có |  |  |
| `message` | template | có |  |  |

- **Opcode:** `comm.hmi_notify` — compiler **desugar** thành `comm.mqtt_publish` JSON `{severity, title, message, ts}` lên topic HMI cấu hình của app (`simvehicleapp/<app>/hmi`). Không có actuator HMI trong VSS 4.0 (skill vss-signals) nên cảnh báo đi qua MQTT.
- **`severity`:** `info` (mặc định)/`warning`/`critical`; **`title`**, **`message`:** template.

### Log — `sv_log`

opcode `comm.log` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `level` | enum |  | "info" | "debug", "info", "warn", "error" |
| `message` | template | có |  |  |

- **Opcode:** `comm.log`. Bước thường, không yield; ghi log JSON một dòng của app (thấy ở Run console, M8).
- **`level`:** `debug`/`info` (mặc định)/`warn`/`error`; **`message`:** văn bản, `<ref>` viết thẳng trong chữ được thay bằng giá trị (`Speed <Vehicle.Speed> km/h`); ngoặc nhọn là chữ thường (ADR-0013 Notes M03-T11).

### Publish MQTT — `sv_mqtt_publish`

opcode `comm.mqtt_publish` · phiên bản 1 · vào [target] · ra [source, error]

| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |
|---|---|---|---|---|
| `topic` | string | có |  |  |
| `payload` | template | có |  |  |
| `payloadType` | enum |  | "text" | "text", "json" |
| `qos` | enum |  | 0 | 0, 1, 2 |
| `retain` | boolean |  | false |  |

- **Opcode:** `comm.mqtt_publish`. Gửi không chờ xác nhận (không yield, ADR-0012 §3); lỗi gửi ⇒ handle `error`.
- **`topic`:** chuỗi topic (không wildcard); **`payload`:** văn bản với `<ref>` thay bằng giá trị (ngoặc nhọn là chữ thường, nên JSON viết thẳng: `{"speed": <Vehicle.Speed>}`); **`payloadType`:** `text` (mặc định) hoặc `json` (payload phải là JSON hợp lệ sau khi thay template); **`qos`:** 0/1/2 (mặc định 0); **`retain`:** mặc định false.

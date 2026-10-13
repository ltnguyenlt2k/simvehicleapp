# Dùng tín hiệu VSS riêng (mô hình VSS tuỳ biến)

SimVehicleApp có sẵn hai release COVESA VSS là **v4.0** và **v4.2**. Khi cần tín hiệu mà VSS chuẩn không có (tín hiệu
riêng của OEM hoặc ECU thử nghiệm) hoặc muốn dùng hẳn một file VSS khác, hãy tạo **mô hình tuỳ biến**: một release tên
`vX.Y-<tên>`, ví dụ `v4.0-acme`. Sau đó toàn bộ chuỗi làm việc với release này giống hệt v4.0:

- cây signal và các block trên canvas;
- lint, Simulate;
- SynCode C++, Python, Rust;
- Run trên databroker và inject signal.

Thiết kế: [ADR-0052](../../analysis/adr/ADR-0052-custom-vss-models.md).

## 1. Hai cách tạo

**a) Overlay: thêm hoặc sửa vài node trên VSS chuẩn.** Viết file JSON có cùng cấu trúc với `vss_rel_X.Y.json`,
nhưng chỉ chứa các node cần thêm hoặc đổi. Ví dụ đầy đủ ở
[`docs/examples/vss/overlay-acme.json`](../examples/vss/overlay-acme.json):

```json
{"Vehicle": {"children": {"Acme": {"type": "branch", "description": "Vendor signals", "children": {
  "DriverMonitor": {"type": "branch", "description": "Driver monitoring", "children": {
    "DrowsinessLevel": {"type": "sensor", "datatype": "uint8", "min": 0, "max": 3, "description": "0 alert … 3 asleep"}}},
  "Hmi": {"type": "branch", "description": "Cluster", "children": {
    "WarningLevel": {"type": "actuator", "datatype": "uint8", "min": 0, "max": 3, "description": "0 none … 3 critical"}}}}}}}}
```

```bash
scripts/sv vss add v4.0-acme --overlay docs/examples/vss/overlay-acme.json   # trộn lên COVESA v4.0
```

Quy tắc trộn:
- Node đã có thì giữ nguyên thuộc tính, trừ thuộc tính overlay ghi đè (ví dụ đổi `max` của `Vehicle.Speed`).
- Node mới được thêm theo thứ tự trong file.
- Node mới phải có `type` (`branch`, `sensor`, `actuator`, `attribute`), `description`, và `datatype` nếu là
  sensor/actuator/attribute.

**b) Một file VSS hoàn chỉnh.** Phù hợp khi đã có bộ `.vspec` của OEM: xuất ra JSON bằng
[vss-tools](https://github.com/COVESA/vss-tools) (`vspec export json …`), rồi:

```bash
scripts/sv vss add v4.0-oem /path/to/oem_vss.json
```

Cả hai cách đều được catalog kiểm tra ngay. File sai sẽ báo đúng chỗ lỗi, ví dụ
`vss-catalog rejected v4.0-x (503): Vehicle.X: unknown datatype 'uint9'`.

## 2. Thiết kế workflow và sinh code
1. Studio → **New project** → chọn VSS `v4.0-acme`.
2. Kéo block như bình thường: tìm `DrowsinessLevel` trong bảng Signals, dùng `On signal changed` → `If` → `Set actuator`.
3. Simulate, rồi SynCode. Vehicle model Velocitas được sinh từ file VSS tuỳ biến, nên code C++/Python/Rust gọi thẳng
   `Vehicle.Acme.…`.

Workflow tạo trên `v4.0` không dùng được signal riêng: lint báo `VEHICLE_PATH_NOT_FOUND`. Project và workflow phải dùng
cùng release.

## 3. Chạy thật (Run + inject)

```bash
scripts/sv vss use v4.0-acme     # databroker-custom nạp mô hình này; Run/inject của project v4.0-acme chạy trên nó
scripts/sv vss list              # v4.0 (default) · v4.0-acme (custom, databroker-custom) · v4.2
```

Mỗi lúc chỉ một mô hình tuỳ biến được nối databroker để Run. Catalog vẫn phục vụ tất cả, nên thiết kế, Simulate và
SynCode vẫn làm được trên mọi mô hình.

## 4. Thêm hoặc đổi tín hiệu về sau
Sửa overlay (hoặc file) rồi chạy lại `scripts/sv vss add v4.0-acme …`. Project đã tạo trên release đó **tự cập nhật**
ở lần SynCode kế tiếp:
1. Build log hiện dòng "VSS v4.0-acme changed in the catalog".
2. Vehicle model được sinh lại.
3. Databroker-custom nạp lại nếu release đang `use`.

Không cần tạo lại project.

## 5. Gỡ

```bash
scripts/sv vss remove v4.0-acme
```

Project đã tạo trên release này vẫn giữ bản copy file VSS, nhưng không SynCode được nữa cho tới khi release được thêm lại.

## 6. Kiểm tra toàn bộ chuỗi (dành cho dev)
`modules/simvehicleapp-orchestrator/gate/vss-custom-gate.sh [release] [langs]` chạy trên stack dev:
1. Thêm overlay ví dụ.
2. Với từng ngôn ngữ: lint → simulate → SynCode → Run + inject.
3. Thêm một signal vào model, rồi SynCode lại cùng project.

Nightly chạy bản C++.

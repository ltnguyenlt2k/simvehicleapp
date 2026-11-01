# Workflow robot (miền Robot) — điều khiển dog mô phỏng

Workflow robot được soạn ngay trong studio hiện có. Một workflow là **miền Robot** khi canvas có block robot (`rf_*`). Khi đó:
- toolbar chỉ hiện block robot (cùng ghi chú, loop, parallel);
- thanh trên canvas đổi thành thanh **Robot**;
- dock dưới thành panel **Kiểm tra / Chạy**.

Luồng chạy: workflow → compiler RobotFlow → app Python → Protobus → bridge ROS 2 → robot dog (repo `dog-ros2-simulation`).

Hai repo khởi động độc lập. Chúng chỉ nói chuyện qua giao thức:
- topic ROS 2 `/dog1/workflow/request` và `/dog1/workflow/ack`;
- HTTP của Robot Zoo.

## 1. Khởi động

```bash
# repo dog (thư mục riêng): stack mô phỏng + Robot Zoo
cd ../04.dog-ros2-simulation && docker compose up -d
```

```bash
# repo này: build image robotics một lần rồi bật Protobus (mock + ros) và robotics-control
robotics/scripts/sr build
```

```bash
COMPOSE_PROFILES=ros robotics/scripts/sr up
```

```bash
# studio kèm overlay robotics (studio vào mạng sr-gui-v1, gọi robotics-control qua x-sv-internal)
docker compose -p simvehicleapp --env-file .env -f modules/simvehicleapp-studio/compose.simvehicleapp.yaml -f modules/simvehicleapp-studio/compose.robotics.yaml up -d studio
```

Biến môi trường:
- `SV_ROBOTICS_URL`: studio dùng để gọi robotics-control. Overlay đã đặt sẵn.
- `INTERNAL_API_SECRET`: khoá dùng chung giữa studio và robotics-control.
- `SR_DOG_NETWORK`: mạng Docker của repo dog, mặc định `dog-ros2_robot`.

## 2. Soạn workflow

Kéo block robot từ toolbar (17 block, danh sách ở `robotics/robotflow/registry.json`):
- **Kích hoạt:** **Khi bắt đầu**, **Khi điều kiện đúng**, **Mỗi chu kỳ**.
- **Luồng:** **Nếu / Không thì**, **Chờ**, **Chờ đến khi**, **Lặp N lần**, **Kết thúc**.
  - Điều kiện là biểu thức trên path RSS, ví dụ `Robot.Battery.StateOfCharge > 30`.
- **An toàn:** **Arm (sẵn sàng)**, **Disarm**, **Dừng khẩn (Stop)**, **Bỏ chốt Stop**.
- **Chuyển động:** **Di chuyển** (vận tốc trong một khoảng thời gian), **Thực hiện động tác** (BOW, JUMP, LIFT_FRONT_LEFT…).
- **Điều hướng:** **Đi tới điểm**, **Đi theo tuyến**.
- **Dữ liệu:** **Ghi log**.

Mỗi block có cổng ra có tên, ví dụ `ok`/`failed` hoặc `true`/`false`. Vòng lặp nối cạnh quay lui về block **Lặp N lần**. Studio chỉ cho phép chu trình giữa hai block robot.

Panel **Kiểm tra** chạy compiler sau mỗi lần sửa (debounce 400 ms) và báo lỗi theo mã `RF*`, ví dụ:
- thiếu Arm trước lệnh chuyển động (RF4001);
- cổng lỗi chưa nối (RF4002);
- vòng lặp bận (RF4003);
- block không chạy tới được (RF1007).

## 3. Build → Deploy → Start / Stop

Trên thanh **Robot**:
1. Chọn mode **Dog ROS sim**. Mode **Mock** chạy mô phỏng nhẹ, không cần ROS. Bên cạnh hiện robot quan sát được (id · mode · scene).
2. Bấm **Build** khi trạng thái kiểm tra là OK. Build sinh app Python bất biến; build lại cùng workflow cho cùng bytes.
3. **Deploy** gắn build vào robot đang quan sát. Deploy không chạy và không Arm robot.
4. **Start**, rồi **Xác nhận Start**. App giành lease điều khiển và gửi lệnh qua `/dog1/workflow/request`.
5. **Robot Zoo** mở tab mới để xem robot 3D.

Trong lúc chạy:
- block đang thực thi có viền sáng trên canvas;
- panel **Chạy** liệt kê kết quả từng lệnh (SUCCEEDED / REJECTED / …, kèm request id) và log;
- **Stop** luôn có. Stop đi theo làn an toàn riêng và chờ robot xác nhận `SAFE_STOP`.

Operator trên Robot Zoo luôn được ưu tiên. Nếu operator giành quyền, lease của workflow bị thu hồi và các lệnh sau bị từ chối.

## 4. Giới hạn hiện tại
- Chưa có động tác WAVE/SIT/STAND (dog R4 W2) và chưa đặt được mức pin (W3).
- Trợ lý AI chưa có tool cho block robot (M26-T10).

Chi tiết thiết kế: [docs/design/robotics](../design/robotics/README.md) · ADR-0064…0071.

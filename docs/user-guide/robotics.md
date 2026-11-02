# Workflow robot — điều khiển robot dog mô phỏng bằng kéo thả

Workflow robot được soạn ngay trong studio SimVehicleApp, cùng giao diện với workflow xe.

Luồng chạy: workflow → compiler RobotFlow → app Python → Protobus → bridge ROS 2 → robot dog (repo `dog-ros2-simulation`).

Hai repo khởi động độc lập và chỉ nói chuyện qua giao thức:
- topic ROS 2 `/dog1/workflow/request` và `/dog1/workflow/ack`;
- HTTP của Robot Zoo.

**Video hướng dẫn (tiếng Việt, cho người mới):** [robot-tutorial-vi.mp4](../media/robotics/robot-tutorial-vi.mp4). Video đi hết các bước dưới đây trên hệ thống thật.

## 1. Khởi động

```bash
# repo dog (thư mục riêng): mô phỏng robot + Robot Zoo
cd ../04.dog-ros2-simulation && docker compose -p dog-ros2 -f deploy/compose/compose.yaml -f deploy/compose/moderate.yaml up -d
```

```bash
# repo này: build image robotics một lần, rồi bật Protobus (mock + ros) và robotics-control
robotics/scripts/sr build
```

```bash
COMPOSE_PROFILES=ros robotics/scripts/sr up
```

```bash
# stack SimVehicleApp kèm overlay robotics (studio vào mạng sr-gui-v1, gọi robotics-control bằng khoá nội bộ)
scripts/sv up && docker compose --env-file .env -f docker-compose.yml -f modules/simvehicleapp-studio/overlays/robotics.yaml up -d studio
```

Biến môi trường:
- `SV_ROBOTICS_URL`: địa chỉ studio dùng để gọi robotics-control. Overlay đã đặt sẵn.
- `INTERNAL_API_SECRET`: khoá dùng chung giữa studio và robotics-control.
- `SR_DOG_NETWORK`: mạng Docker của repo dog, mặc định `dog-ros2_robot`.

## 2. Ngôn ngữ giao diện (VI / EN)

**Studio:**
- Settings › General › **Language / Ngôn ngữ**, hoặc nút **EN | VI** ở góc trên trang đăng nhập và đăng ký.
- Đổi ngôn ngữ sẽ tải lại trang. Mỗi chế độ hiển thị một ngôn ngữ.
- Những phần giữ nguyên ở cả hai chế độ:
  - path tín hiệu (`Robot.…`, `Vehicle.…`) và mô tả lấy từ spec VSS/RSS;
  - mã lỗi;
  - tên mode của robot (`DISARMED`…);
  - lệnh an toàn (Arm, STOP).

**Robot Zoo:**
- Nút **VI | EN** cạnh trạng thái kết nối.
- Nút **Robot Zoo** trong studio mở Robot Zoo cùng ngôn ngữ với studio (`?lang=`).

**Tên block** mặc định luôn là tiếng Anh (`On start 1`, `Wait for IsDetected`…). Bạn đổi tên tự do, kể cả sang tiếng Việt: chọn block, rồi nhấp đúp vào tên ở tab Trình soạn.

## 3. Tạo workflow robot

1. Bấm **+** cạnh mục **Workflow** ở thanh bên để tạo workflow mới. Chuột phải › **Đổi tên** để đặt tên.
2. Mở tab **Thanh công cụ**. Ở ô **Tín hiệu**, chọn **RSS 0.1 · robot dog-go2-sim**:
   - khu **Robot** hiện cây tín hiệu của robot (RSS), giống cây VSS của xe;
   - palette chỉ còn 17 block robot.

   Workflow mới mặc định là xe (VSS). Không đổi được miền khi canvas còn block của miền kia.
3. Kéo block từ thanh công cụ vào canvas:
   - **Kích hoạt:** Khi bắt đầu, Khi điều kiện đúng, Mỗi chu kỳ.
   - **Luồng:** Nếu / Không thì, Chờ, Chờ đến khi, Lặp N lần, Kết thúc.
   - **An toàn:** Arm (sẵn sàng), Disarm, Dừng khẩn (Stop), Bỏ chốt Stop.
   - **Chuyển động:** Di chuyển, Thực hiện động tác (Cúi chào, Nhảy, Giơ chân trước trái…).
   - **Điều hướng:** Đi tới điểm, Đi theo tuyến.
   - **Dữ liệu:** Ghi log.
4. **Kéo một tín hiệu** từ cây RSS vào canvas, ví dụ `Robot.Perception.Marker.IsDetected`. Menu hiện **Khi điều kiện đúng / Nếu / Chờ đến khi**, với điều kiện điền sẵn (`… == true`).
5. Chọn block để sửa thiết lập ở tab **Trình soạn**:
   - điều kiện là biểu thức trên path RSS, ví dụ `Robot.PowerSystem.Battery.StateOfCharge >= 20 %`;
   - nội dung log chèn được giá trị tín hiệu, ví dụ `{{Robot.Pose.Position.X}}`.
6. Nối các cổng có tên: **xong / lỗi**, **đúng / sai**, **lặp / xong lặp**, **hết giờ**. Vòng lặp nối ngược về block **Lặp N lần**.

Mỗi block hiện một dòng tóm tắt (KHI / NẾU / LUỒNG / LÀM / GỬI…) giống block xe. Nút **Chi tiết** trên thanh hiện mọi thiết lập của block.

## 4. Kiểm tra → Biên dịch → Triển khai → Chạy / Dừng

Thanh trên canvas có cùng bố cục với thanh của workflow xe:
- **Kiểm tra** và chip trạng thái: compiler tự chạy mỗi khi bạn sửa. Tab **Vấn đề** ở dock dưới liệt kê lỗi theo mã `RF*`, bấm vào lỗi để chọn block.
  - Ví dụ: thiếu Arm trước động tác (RF4001), cổng lỗi chưa nối (RF4002), block không chạy tới được (RF1007).
- **Biên dịch**: sinh app robot Python bất biến (cùng workflow cho cùng bytes).
- **Triển khai**: gắn bản biên dịch vào robot đang chọn (**Dog ROS sim** hoặc **Mock**). Bước này không chạy và không Arm robot.
- **Chạy**, rồi **Xác nhận chạy**: app giành quyền điều khiển và gửi lệnh qua `/dog1/workflow/request`.
- **Robot Zoo**: mở mô phỏng robot 3D ở tab mới.
- Bên phải thanh là gợi ý bước tiếp theo, hoặc lý do một thao tác chưa làm được.

Trong lúc chạy:
- block đang thực thi có viền sáng trên canvas;
- tab **Trực tiếp** hiện:
  - trạng thái lượt chạy;
  - từng block được chạy (`→ Cúi chào`);
  - kết quả từng lệnh robot (SUCCEEDED / REJECTED / … kèm request id);
  - log của workflow;
- ở Robot Zoo, tab **Log & chẩn đoán** hiện log ROS của chính robot;
- nút **Dừng** luôn sẵn sàng: đi theo làn an toàn riêng và chờ robot xác nhận `SAFE_STOP`.

Operator trên Robot Zoo luôn được ưu tiên. Nếu operator giành quyền điều khiển, workflow bị thu hồi quyền và các lệnh sau bị từ chối.

## 5. Giới hạn hiện tại
- Chưa có động tác vẫy, ngồi, đứng (dog R4 W2) và chưa đặt được mức pin (W3).
- Trợ lý AI chưa có tool cho block robot (M26-T10).
- Mô tả tín hiệu trong cây VSS/RSS (tooltip) lấy nguyên từ spec nên vẫn là tiếng Anh ở chế độ VI.

Chi tiết thiết kế: [docs/design/robotics](../design/robotics/README.md) · ADR-0064…0072.

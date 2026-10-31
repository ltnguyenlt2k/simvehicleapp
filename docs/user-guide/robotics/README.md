# Robot Studio trong WSL Ubuntu

Robot Studio là giao diện robotics độc lập của simvehicleapp. Workflow được biên dịch thành ứng dụng native duy nhất; Mock và ROS chạy cùng artifact, không có bộ thông dịch graph trong browser. AI assistance chưa nằm trong v0.1; bạn tạo bằng template, palette và thuộc tính.

## Khởi động

Repo: `/home/lenovo/02_Projects/09.simvehicleapp`. Dog: `/home/lenovo/02_Projects/04.dog-ros2-simulation`. Chạy Docker trong WSL Ubuntu24.04.

```bash
bash robotics/scripts/sr studio build --live
bash robotics/scripts/sr studio up --live --authorize-sim-arm
```

Dog phải chạy với project `dog-ros2-r1`, domain52, cổng8092 trước khi bật bridge live. Bật thêm `DOG_STUDIO_ENABLED=1` trong `tools/dev` của Dog sau khi Studio đã tạo mạng/volume; xem Dog `docs/validation/studio-workflow.md`. Mở Studio tại `http://127.0.0.1:3180`.

Chỉ cần Mock thì dùng `studio build` và `studio up` không có `--live`. `studio status` xem dịch vụ. `studio down` dừng runner an toàn và giao diện, giữ project và không tắt Dog/broker.

## Tạo và kiểm tra workflow

1. Chọn Projects → đặt tên → chọn template hoặc canvas trống → Tạo project.
2. Dùng palette để thêm bước hoặc kéo thả. Chọn node để sửa giá trị có kiểu. Các đơn vị như `0.2 m/s`, `15 %` thuộc biểu thức; không nhập mã Python.
3. Kéo cổng để nối hoặc chọn đích trong **Các nhánh**. Mọi kết quả của lệnh robot cần nhánh xử lý. Xóa nhánh sẽ hiện diagnostic thật từ compiler.
4. Mở **Tín hiệu RSS** để tìm đường dẫn. Biến được khai báo trong bảng bên trái. Di chuyển node không làm thay đổi logic native.
5. Cho phép Arm SIM trong bản build nếu workflow có bước Arm. Chính checkbox không chạy/Arm robot. Build xác minh artifact bằng SDK đã cài; Deploy lưu cố định source, catalog/runtime và đích.

RW-A: marker → nhấc chân → cúi chào. RW-B: tuần tra hai vòng + giám sát vật cản. RW-C: sự kiện jump. RW-D: pin yếu đủ5s → Cancel/CROUCH/Disarm/Stop. RW-E:37 node, chờ/kiểm tra marker, vòng lặp chào, nhánh pin, tiến/lùi, Disarm và monitor pin thấp đủ1s → Stop ưu tiên. Có thể chỉnh số vòng trong canvas; video kiểm chứng dùng2.

## Simulate và Test

Chọn **Mô phỏng nhẹ (Mock)**, Build → Deploy → **Chạy thử trên Mock**. Flow tô node theo trace native; telemetry và vị trí lấy từ Protobus. Nút sự kiện xuất hiện theo các trigger đã khai báo. DỪNG luôn ở thanh trên.

Trong **Test kịch bản trên Mock**, sửa JSON `scenario.v1` và xem timeline/kỳ vọng bên cạnh. **Chạy Test** là hành động rõ ràng để reset Mock và chạy artifact; không có endpoint bơm tín hiệu trên ROS. Bản ví dụ cho bốn mẫu có sẵn. Có thể đặt sensor, ép kết quả lệnh hoặc gửi event theo `atMs`.

- `timeScale=1` là mức được hỗ trợ; không tăng tốc vật lý hay làm sai cửa sổ thời gian.
- `durationMs` xác định toàn bộ thời gian quan sát (tối đa120s); `toleranceMs` tối đa500ms.
- Kỳ vọng `invoke` so chính xác path/args, phase và count từ audit lệnh thật, thuộc đúng fence/broker của run; cửa sổ tính từ `bus_bound`, theo thời điểm gọi lệnh.
- `forbid` quan sát đủ cả cửa sổ; `log` so log native. Kỳ vọng dương theo thứ tự bắt đầu, có cửa sổ riêng.
- Cancel không có công việc đang chạy có thể thành công mà không phát command; không tạo một lệnh RSS Cancel giả để làm đẹp báo cáo.
- PASS chỉ khi mọi kỳ vọng đạt, không mất/truncated lịch sử và Stop đã xác nhận. Kỳ vọng sai phải FAIL. Có nút tải báo cáo JSON.

## Run trên Robot Zoo

Chọn **Robot Zoo (ROS)**, Build và Deploy; hai thao tác này không chạy robot. **Mở Robot Zoo** mở tab mới chỉ mang UUID deployment. Kiểm tra tên → **Start workflow**. Runtime chạy đúng artifact đã cố định. Không tự Start lại sau reload, mất mạng hoặc restart.

Dùng **Dừng workflow** để dừng runtime. STOP toàn cục của Robot Zoo còn hoạt động trực tiếp với Brain khi Studio offline. Không coi thông báo đã gửi yêu cầu là xác nhận vật lý. Runtime từ chối khi tư thế, epoch/map, runtime/catalog hoặc authority không phù hợp.

Sau Reset world/đổi map, build/deploy mới rõ ràng; bản cũ không tự đổi target. Chạy lại từ tư thế chưa sẵn sàng phải từ chối và đi nhánh an toàn. Simulation only; chưa có gate phần cứng.

**Xuất bản deploy** tải ZIP chứa10 file native cùng project source, deployment và target. Có thể kiểm tra artifact hash trong chi tiết bản deploy.

## Quay lại full flow

```bash
bash robotics/scripts/sr demo-video --out video-my-run
```

Lệnh tạo project37 bước, chỉnh vòng lặp2, kiểm chứng diagnostic, build/deploy, mở Robot Zoo và Start, đối chiếu trace/pose thật, dừng và export. Nó reset world trong bước chuẩn bị và chạy robot mô phỏng; hãy để robot idle trước khi gọi. Mỗi thư mục output phải mới. Video H.264 là bản ghi X11 liên tục cả browser qua các tab, không ghép các clip. File nằm tại `robotics/runtime/m27/video-my-run/full-flow.mp4` cùng JSON bằng chứng và ZIP. Các lượt ROS dùng khóa để không chạy chồng nhau.

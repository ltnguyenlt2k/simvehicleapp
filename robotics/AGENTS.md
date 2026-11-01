# robotics/ — luật cho agent (bổ sung AGENTS.md gốc)

Đọc trước: `docs/design/robotics/README.md`, ADR-0064…0071, phase hiện tại `analysis/phases/M22…M28`, `docs/ROADMAP.md`.

1. **Lớp.**
   - Thứ tự lớp: `contracts` ← `rss` ← `protobus` ← `robotflow` ← `rfrt` ← `control`.
   - Một lớp chỉ import package của mình và các lớp bên trái.
   - Lúc chạy, các lớp gọi nhau qua giao diện công bố: gRPC `protobus.v1` hoặc HTTP JSON theo `contracts/schemas`.
2. **Ranh giới repo.**
   - Không import hay copy giữa `robotics/**` và `modules/**`.
   - Studio chỉ gọi robotics qua HTTP (BFF `/api/sv/robotics/*`).
   - Robot dog là repo khác, chỉ nối qua ROS 2 DDS từ `protobus/ros2`. Không vendor code dog; ghi commit đã đối chiếu.
3. **Không có GUI soạn thảo thứ hai.** UI robotics nằm trong studio hiện có (ADR-0068).
4. **An toàn (ADR-0069).**
   - Chỉ gửi lệnh cấp cao qua `/dog1/workflow/request`.
   - Deploy không Arm, không Start.
   - Stop đi làn an toàn riêng.
   - Chỉ chạy mô phỏng.
5. **Tất định và mã ổn định.**
   - Cùng input ⇒ cùng bytes (catalog, IR, code sinh ra).
   - Mã `RS*`/`PB*`/`RF*` là API công khai: chỉ thêm, không đổi tên hay xoá.
6. **Chạy và test.**
   - Mọi thứ chạy trong Docker (`scripts/sr`); port bind `127.0.0.1`.
   - Mỗi container có giới hạn RAM/CPU/pids (ADR-0070).
   - Test chạy trong image `robotics/python-dev` (`scripts/sr test`).
   - Bằng chứng runtime để ở `runtime/` (bị ignore); báo cáo chọn lọc để ở `docs/reports/`.

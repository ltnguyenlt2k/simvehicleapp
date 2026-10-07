# Tutorial: "Overspeed warning" trong 10 phút

Bạn sẽ dựng một vehicle app thật — **bật đèn cảnh báo nguy hiểm (hazard) khi tốc độ vượt 120 km/h liên tục 2 giây** —
không viết dòng code nào: kéo khối trên canvas, mô phỏng, sinh app Velocitas C++ (SynCode), chạy nó trên KUKSA databroker
thật và bơm tín hiệu để xem nó phản ứng. Đây chính là golden workflow GW-A và là kịch bản của bài kiểm thử usability v1.0.

Yêu cầu: stack đang chạy (`scripts/sv up`, xem [OPERATIONS](../dev/OPERATIONS.md)), mở <http://localhost:3000>.

## 1. Tài khoản và workflow (1 phút)
1. **Sign up** (tên, email, mật khẩu) — bạn vào workspace của mình.
2. Mở **Search** (thanh bên, hoặc ⌘K / Ctrl+K), gõ `Create workflow`, chọn **Create workflow**. Canvas trống mở ra.

## 2. Trigger: khi tốc độ thay đổi (1 phút)
1. Ở panel bên phải, tab **Toolbar**, phần **Vehicle**: tìm `Vehicle.Speed`.
2. Kéo dòng `Vehicle.Speed` thả vào canvas, chọn **When Speed changes** (`sv_on_signal_changed`). Khối
   **When Speed changes 1** xuất hiện — đầu ra của nó là `<whenspeedchanges1.value>`.

## 3. Điều kiện giữ 2 giây (2 phút)
1. Trong Toolbar, kéo khối **Stable for** vào canvas, bên phải trigger.
2. Chọn khối, trong editor đặt:
   - **Condition**: `<whenspeedchanges1.value> > 120`
   - **Duration**: `2000` (ms)
3. Nối handle phải của trigger vào khối **Stable for**.

`Stable for` chỉ đi tiếp qua nhánh **stable** khi điều kiện đúng liên tục suốt thời gian đó; tốc độ thay đổi giữa chừng
sẽ bắt đầu lại cửa sổ (chính sách `restart` của trigger).

## 4. Hành động: bật hazard (1 phút)
1. Trong phần Vehicle, tìm `Vehicle.Body.Lights.Hazard.IsSignaling`, kéo vào canvas và chọn **Set**
   (`sv_set_actuator`). Chỉ actuator mới có lựa chọn Set — sensor thì không.
2. Đặt **Value**: `true`.
3. Nối handle **stable** của `Stable for` vào khối **Set IsSignaling 1**.

Tab **Problems** phải trống. Nếu có lỗi (ví dụ tham chiếu sai tên), click vào lỗi để nhảy tới khối.

## 5. Mô phỏng (2 phút)
1. Mở tab **Simulation timeline** ở dock dưới (bảng scenario: giá trị ban đầu và input theo thời gian). Thêm input: `t = 1000 ms`, `Vehicle.Speed = 100`; `t = 2000 ms`, `Vehicle.Speed = 130`.
   Độ dài chạy `6000 ms`.
2. Bấm **Simulate**. Timeline cho thấy trigger lúc 1000 và 2000, và **write** `Hazard.IsSignaling = true` lúc **4000 ms**
   (2000 + 2 s). Kéo thanh tua để xem badge trên từng khối.

Scenario bạn lưu ở đây cũng trở thành test sinh ra cho app (bước SynCode chạy nó).

## 6. Sinh app và build (2 phút)
1. Thanh bên → **Vehicle projects** → đặt tên `Overspeed`, bấm **Create project** (chờ trạng thái **Ready**), đánh dấu workflow
   của bạn trong project.
2. Quay lại workflow, bấm **SynCode** (thanh hành động trên canvas). **Build log** hiển thị các bước: IR → codegen →
   ghi file → dependencies → build → format → test. Kết thúc bằng **SynCode passed**.
3. Muốn xem code: **Generated files** trên thẻ project (diff với lần trước), **Open IDE** (code-server, mật khẩu trong `.env`) hoặc
   **Export** (zip build được ngoài SimVehicleApp bằng `app/Dockerfile` của template).

## 7. Chạy trên databroker thật (1 phút)
1. Bấm **Run**. Trạng thái chuyển **running**, Run console có `app.started`.
2. Tab **Signals**: nhập `100` cho `Vehicle.Speed` → **Inject**; rồi `130` → **Inject**, đợi 2 giây.
3. `Hazard.IsSignaling` đổi thành `true` (target và current). Trên canvas, badge live cho thấy khối nào vừa chạy; Run
   console có trace `Set IsSignaling 1`.
4. Bấm **Stop** (app dừng sạch trong < 5 s). **Record** trong tab Signals lưu các lần inject thành scenario mới.

## Làm tiếp
- **Assistant** (tab cạnh Toolbar): mô tả hành vi bằng lời ("Cảnh báo HMI khi pin dưới 20% lúc xe đang chạy"), xem đề xuất
  trên canvas và **Accept**/**Reject**. Không có provider AI nào cấu hình thì dùng `SV_AI_PROVIDER=fake` (giả lập).
- [Tham chiếu khối](blocks.md) — mọi khối, thuộc tính và ngữ nghĩa.
- [System status](../dev/OPERATIONS.md#system-status) — trạng thái các service.

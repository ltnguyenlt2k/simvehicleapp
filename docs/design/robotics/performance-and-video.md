# Hiệu năng trên máy yếu và video full luồng trung thực

> Quyết định: [ADR-0070](../../../analysis/adr/ADR-0070-robotics-performance-budget-low-spec.md) (hiệu năng), [ADR-0071](../../../analysis/adr/ADR-0071-robotics-acceptance-and-honest-video.md) (nghiệm thu + video). Trạng thái: **ngân sách mục tiêu**, chưa đo trên code robotics (chưa có code).

## 1. Máy chuẩn đo

| Hồ sơ | Cấu hình | Dùng cho |
|---|---|---|
| **DEV** (máy hiện tại) | WSL2, 20 CPU logic, 11 GB RAM, không GPU NVIDIA | Đo chính, quay video |
| **LOW** (mô phỏng máy yếu) | Cùng máy, giới hạn bằng `cpuset` 4 CPU logic + tổng cap RAM container 6 GiB | Gate "máy cấu hình thấp" |

**Dữ kiện nền đã đo (không phải của code robotics):**

- Stack xe rảnh khoảng 0,9 GB, peak khi build C++ 1,84 GB (ADR-0051, đo 2026-10-13).
- Dog sim preset `moderate` có tổng cap 4,5 GiB, peak Docker reported khoảng 2,0 GiB, camera 9,8 FPS, WebGL khoảng 60 FPS (dog R3, 2026-10-28).

Robotics phải nằm **thêm** vào đó mà không làm hỏng các số đo này.

## 2. Ngân sách (PHẢI đạt ở gate M27)

| Hạng mục | DEV | LOW |
|---|---|---|
| RAM thêm của robotics (broker + bridge + control + runner + compiler + app) | ≤ 768 MiB | ≤ 768 MiB |
| Tổng RAM container (studio + DB + robotics + dog `moderate`) khi chạy `ros-sim` | ≤ 6 GiB | ≤ 6 GiB (cap cứng) |
| CPU robotics trung bình khi chạy RW-D | ≤ 0,8 core | ≤ 1 core |
| Broker: p95 trễ nguồn → subscriber | < 20 ms | < 40 ms |
| Stop: nhấn nút → `SAFE_STOP` xác nhận trong GUI | p95 < 500 ms | p95 < 700 ms |
| Setpoint vận tốc tới Brain | 20 Hz ± 10 %, không khoảng hở > 150 ms | như DEV |
| Lint (workflow 150 block) | p95 < 400 ms | p95 < 800 ms |
| Build (compile + verify) | < 3 s | < 6 s |
| Canvas: kéo thả 150 block | ≥ 50 FPS | ≥ 30 FPS |
| Live panel trong studio | không long task > 50 ms do live update | như DEV |
| Robot Zoo khi workflow chạy | camera ≥ 8,8 FPS (≥ 90 % mức R3), WebGL ≥ 50 FPS | camera ≥ 5 FPS, WebGL ≥ 30 FPS |
| Khởi động `sr` (không tính dog) | < 20 s tới healthy | < 40 s |

**Kỹ thuật bắt buộc để đạt ngân sách:**

1. **Không truyền ảnh/point cloud qua Protobus.** Bridge chỉ trích tín hiệu dẫn xuất (`Marker.IsDetected`, `Obstacle.MinRange`).
2. **Downsample tại bridge** theo `maxRateHz` của mapping (IMU 100 → 20 Hz, joint 50 → 10 Hz). Gộp latest-wins, không hàng đợi vô hạn.
3. **Subscribe theo nhu cầu.** App chỉ subscribe path compiler xác định; GUI chỉ subscribe path đang hiện. Không có subscriber ⇒ bridge không giải mã topic đó (tạo subscription ROS lười).
4. **Profile compose `robot-lite`.** Chạy studio + DB + realtime + AI (tuỳ chọn) + robotics + dog. **Không** bật toolchain C++/Python/Rust, KUKSA, Velocitas, code-server.
5. **Image dựng sẵn** (như ADR-0051). Không build trên máy yếu; mọi image pin digest.
6. **Giới hạn cứng mọi container robotics:** `mem_limit`, `cpus`, `pids_limit`. Vượt giới hạn ⇒ lỗi rõ ràng, không treo máy.
7. **Studio:**
   - live 10 Hz, batch theo animation frame;
   - tab ẩn dừng stream;
   - không re-render toàn canvas khi trace đến (chỉ đổi class của node).

## 3. Đo và báo cáo

- Script đo (M27) ghi:
  - `docker stats` mỗi 1 s;
  - p50/p95/p99 trễ broker (timestamp nguồn so với lúc nhận);
  - FPS canvas (Playwright + `PerformanceObserver`);
  - FPS camera và WebGL của Robot Zoo bằng công cụ đo R3 của repo dog.
- Mỗi lần đo ghi commit SHA, image digest, hồ sơ máy, thời lượng. **Lần FAIL được giữ lại**, không xoá.
- Không nới ngưỡng an toàn (watchdog, TTL, độ tươi) để đạt ngân sách hiệu năng.

## 4. Video full luồng — quy tắc trung thực (ADR-0071)

**Nội dung bắt buộc** (một video liên tục, hành vi thật). Kịch bản quay gồm hai workflow:

1. **Soạn:** đăng nhập GUI SimVehicleApp → New workflow → miền Robot → kéo thả workflow RW-B/RW-E trên canvas; dùng RSS path selector; Problems hiện lỗi rồi được sửa.
2. **Trợ lý AI** (endpoint thật trong `.env`, model `local-agent`) đề xuất thêm nhánh xử lý lỗi; người dùng xem diff và Accept.
3. **Test** trên mock: một scenario PASS, một scenario FAIL có lý do, sửa workflow, chạy lại PASS.
4. **Build → Deploy `ros-sim`** (hiện target thật) → **Start**.
5. **Cửa sổ Robot Zoo** (repo dog) đặt cạnh: robot thật sự Arm, đi, cúi chào, nhảy, giơ chân vẫy. Flow trong studio tô đúng block cùng lúc; Signals RSS đổi theo.
6. **Stop** giữa chừng ở workflow thứ hai: robot dừng, GUI hiện `SAFE_STOP` đã xác nhận.
7. **Export** artifact.

**Cách quay:**

- Xvfb + hai cửa sổ trình duyệt thật cạnh nhau (studio, Robot Zoo).
- `ffmpeg x11grab` quay **toàn màn hình**, không ghép hình sau.
- Tự động hoá bằng Playwright với nhịp thao tác người dùng (con trỏ hiển thị, gõ từng phím), như `e2e/lib/human.ts` của M21.

**Không được bịa:**

- **Không giả hành vi:** không mock, không provider giả, không dựng cảnh, không chèn ảnh tĩnh. Trong video, mode hiển thị phải là `ros-sim`.
- **Chỉ tua nhanh chỗ chờ.** Chỉ được tua nhanh đoạn chờ > 8 s (build, khởi động), và phải có chữ "tua nhanh ×N" trên hình. Không cắt bỏ lỗi đã xảy ra.
- **Manifest đi kèm video** (`docs/media/robotics/full-flow.manifest.json`):
  - commit SHA hai repo và digest image;
  - thời điểm bắt đầu/kết thúc;
  - danh sách chặng kèm timestamp;
  - `request_id` của mọi lệnh robot trong video, đối chiếu được với audit Protobus và `workflow/ack` của dog trong cùng thư mục bằng chứng.
- **Trước khi quay:** E2E `@live` robotics PASS trên cùng commit; ghi lại kết quả.
- **Kiểm tra sau khi quay:**
  - giải mã toàn bộ file (`ffprobe` + decode không lỗi);
  - so chặng trong manifest với log;
  - xem từng chặng để xác nhận chữ trên hình khớp sự kiện thật.
  - Bất kỳ sai khác nào ⇒ quay lại, không sửa video.
- **Video cũ của Robot Studio độc lập** (archive) không được dùng làm bằng chứng.

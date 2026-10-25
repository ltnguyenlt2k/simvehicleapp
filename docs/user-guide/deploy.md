# Deploy: chạy app trên tín hiệu thật

**Run** và **Deploy** khác nhau ở nguồn tín hiệu ([ADR-0060](../../analysis/adr/ADR-0060-deploy-targets-and-vehicle-io-layers.md)):

| | Run | Deploy |
|---|---|---|
| Tín hiệu VSS | giả lập: bạn inject, test case, Play | từ các layer của xe (CAN, phần cứng) qua databroker của target |
| Inject / Record / Play | có | **tắt**: server trả `SIMULATED_INPUT_DISABLED` |
| App ghi actuator | vào databroker của stack | read-only (mặc định): bị chặn; read-write: chỉ actuator của app, mỗi lần ghi được audit |
| Thời hạn | `SV_RUN_MAX_MINUTES`, có Extend | không tự hết hạn; mỗi workspace tối đa `SV_MAX_DEPLOYMENTS_PER_WORKSPACE` (mặc định 2) |

## Deploy một app
1. SynCode workflow cho xanh, vì Deploy chạy bản build mới nhất.
2. Bấm **Deploy** trên thanh hành động.
3. Chọn target, hoặc chọn **Add a deploy target…** để thêm mới (chỉ admin của workspace):
   - **Name**: tên gợi nhớ, ví dụ `HIL bench`.
   - **Databroker address**: `host:port` của KUKSA databroker (`kuksa.val.v2`), máy SimVehicleApp phải tới được.
   - **TLS** và **Token** (nếu target yêu cầu). Token được mã hoá khi lưu và không hiển thị lại.
4. **Test connection**:
   - kiểm target trả lời;
   - kiểm target có đủ tín hiệu workflow dùng; tín hiệu thiếu được liệt kê.
5. Chọn **Mode**:
   - **Read-only** (an toàn): app chỉ đọc.
   - **Read-write** (chỉ admin): đánh dấu xác nhận danh sách actuator app được ghi.
6. Bấm **Deploy**:
   - pill trên thanh hiện `Deployed · <target> · <mode>`;
   - tab **Live** hiện log, trace và tín hiệu của target (chỉ xem);
   - banner nhắc rằng inject, Record và Play đã tắt.
7. Dừng: bấm **Deployed** → **Stop deployment**.

Một app có thể vừa Deploy (bản đang chạy trên target), vừa Run (bản thử với tín hiệu giả lập) cùng lúc. Run/Stop trên thanh hành động chỉ tác động lên Run.

## Container image
Khi app chạy trên chính thiết bị của xe thay vì trong SimVehicleApp: hộp thoại Deploy → **Deploy as: Container image**.
- **Image**: `registry/repository:tag`, ví dụ `registry.lab:5000/vehicle/hazard:1.0`.
- **Registry**: HTTPS, hoặc HTTP cho registry trong lab. **Username/Password** nếu registry yêu cầu.
- **Push image** build bản Release, dựng image `FROM scratch` và đẩy lên registry. Image gồm binary `/app`, các thư viện nó dùng, `AppManifest.json` và `/licenses/`. Xong thì hộp thoại hiện digest.
- Chạy trên thiết bị:
  ```bash
  docker run -e SDV_VEHICLEDATABROKER_ADDRESS=grpc://<databroker>:55555 -e SDV_MQTT_ADDRESS=mqtt://<broker>:1883 <image>@<digest>
  ```
  App mặc định dùng `kuksa.val.v2`. Cần `KUKSA_DATABROKER_API=sdv.databroker.v1` nếu databroker chỉ có v1.
- Kích thước đo được: app C++ khoảng 20 MB, app Rust khoảng 5 MB. App Python chưa hỗ trợ.
- **Eclipse Kanto** (xe chạy kanto-cm): sau khi push, bấm **Download Kanto descriptor**. Bạn nhận được file `<app>.json`, một descriptor container-management của kanto-cm v1.0.0, gồm:
  - image theo digest;
  - `network_mode: host` và `restart_policy: unless-stopped`;
  - env trỏ tới databroker (`kuksa.val.v2`, `127.0.0.1:55555`) và MQTT (`127.0.0.1:1883`) của xe.

  Chép file vào thư mục `deployment.ctr_dir` của kanto-cm: lúc khởi động, Kanto kéo image và chạy app. Sửa địa chỉ trong `config.env` nếu databroker hoặc broker của xe ở chỗ khác. SimVehicleApp không chạy Kanto trong stack ([ADR-0050](../../analysis/adr/ADR-0050-kanto-ide-proxy-vss-overlay.md) Notes).

## Bên trong
- App của deployment nối tới **vehicle-gateway** (`vehicle-gateway:<port>`), không nối thẳng tới target. Gateway thêm TLS và token, cho qua phương thức đọc và chặn phương thức ghi theo mode.
- Audit một deployment: `GET /runs/<id>/audit` của orchestrator, ví dụ `scripts/sv` hoặc `curl` trong mạng `sv-internal`.
- Gate kiểm toàn bộ luồng trên stack dev: `modules/simvehicleapp-orchestrator/gate/m18-deploy.sh`.

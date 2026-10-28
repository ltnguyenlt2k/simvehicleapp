# 16 — Glossary

| Thuật ngữ | Nghĩa trong SimVehicleApp |
|---|---|
| **SimVehicleApp** | Sản phẩm vehicle no-code toolchain (fork Sim + các module) |
| **Meta-repo** | Repo `simvehicleapp` gom các repo con bằng git submodule + lock |
| **Module / repo con** | Một repo độc lập (vd `compiler-code-cpp`) với contract, version, CI riêng |
| **Contract** | Schema/API có version trong `simvehicleapp-contracts` |
| **VSS** | COVESA Vehicle Signal Specification — cây tín hiệu `Vehicle.*` |
| **Signal / path** | Một leaf VSS, ví dụ `Vehicle.Speed` |
| **Sensor / Actuator / Attribute** | Loại leaf VSS: đọc / đọc-ghi / tĩnh |
| **Velocitas** | Eclipse Velocitas — framework + template + SDK cho Vehicle App |
| **Vehicle App** (PO gọi "ux-app"/"workflow-app") | Ứng dụng Velocitas sinh ra từ project SimVehicleApp |
| **KUKSA Databroker** | Máy chủ gRPC giữ/phân phối giá trị VSS |
| **Provider / Feeder** | Thành phần cung cấp giá trị sensor hoặc thực thi actuator cho databroker |
| **Workflow** | Đồ thị block trên canvas, gồm ≥ 1 trigger |
| **Trigger (hat)** | Block bắt đầu một lần chạy |
| **Run instance** | Một lần thực thi workflow kể từ khi trigger bắn (tương tự "thread") |
| **Yield point** | Bước làm run tạm dừng (wait, read, write…) |
| **Strand** | Event loop 1 thread trong runtime, chạy mọi logic workflow tuần tự |
| **Concurrency policy** | restart / ignore / queue / parallel khi trigger bắn lúc run cũ đang chạy |
| **WorkflowGraph** | Dạng chuẩn hoá của workflow, đầu vào compiler |
| **IR** | Canonical Intermediate Representation — hợp đồng giữa core và backend |
| **Opcode** | Loại thao tác trong IR (`vehicle.write`, `control.wait`…) |
| **Diagnostic** | Lỗi/cảnh báo có mã ổn định, trỏ về block |
| **Backend / `compiler-code-<lang>`** | Plugin IR → source của một ngôn ngữ + runtime ngôn ngữ đó |
| **Runtime library** | Thư viện viết tay mà code sinh ra gọi vào (timer, policy, trace…) |
| **Toolchain** | Container chạy Velocitas CLI/Conan/CMake để build/test/run |
| **SynCode** | Hành động: compile → generate → ghi workspace → build → test |
| **Generation** | Kết quả một lần SynCode (`generationId`) |
| **Live Run** | Chạy app đã build headless với databroker thật |
| **Simulate** | Chạy IR trong simulator với virtual clock |
| **Trace** | Dòng `SVTRACE {json}` do runtime phát, map về block |
| **Parity** | Trace simulator ≡ trace binary thật |
| **WorkflowPatch** | Tập thao tác sửa workflow do AI đề xuất |
| **MCP** | Model Context Protocol — giao thức tool cho LLM |
| **Entitlement** | Quyền theo license (export source, ngôn ngữ…) |
| **Golden workflow** | Workflow chuẩn GW-A..G dùng làm test hồi quy |
| **RSS** | Robotic Signal Specification — đặc tả tín hiệu robot định dạng `*.rss.yaml` riêng, gốc `Robot`, kind sensor/attribute/setpoint/command ([ADR-0065](adr/ADR-0065-rss-robotic-signal-specification.md)) |
| **Stack robotics** | Sản phẩm robot độc lập trong `robotics/`, không dùng chung code/contract/hạ tầng với stack xe ([ADR-0064](adr/ADR-0064-robotics-independent-stack.md)) |
| **Protobus** | Bus tín hiệu RSS tự viết: giao thức `protobus.v1`, broker, bridge ROS 2, provider mock ([ADR-0066](adr/ADR-0066-protobus-rss-ros2-bridge.md)) |
| **Mapping profile** | File `mapping.yaml` của một robot: ánh xạ node RSS ↔ topic/field/transform/lệnh ROS 2, kèm adapter |
| **Setpoint (RSS)** | Giá trị điều khiển liên tục, struct nguyên tử, có TTL; hết hạn ⇒ broker áp `safeValue` |
| **Command (RSS)** | Lệnh rời rạc có vòng đời chuẩn `PENDING → ACCEPTED/REJECTED → RUNNING → SUCCEEDED/FAILED/CANCELLED/TIMED_OUT` |
| **Lease điều khiển** | Quyền điều khiển một robot, broker cấp cho đúng một client tại một thời điểm |
| **RobotFlow** | Ngôn ngữ workflow robot: `robotflow.v1`, IR `rfir.v1`, compiler `rflowc`, runtime `rfrt` ([ADR-0067](adr/ADR-0067-robotflow-language-compiler-runtime.md)) |
| **Robot Studio** | Web app kéo thả cho robot (tên tạm), tách khỏi studio xe ([ADR-0068](adr/ADR-0068-robot-studio-run-and-scenarios.md)) |

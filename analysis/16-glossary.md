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

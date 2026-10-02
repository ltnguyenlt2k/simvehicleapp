# 01 — Requirements (Yêu cầu hệ thống SimVehicleApp)

> Nguồn yêu cầu: (a) yêu cầu gốc của product owner (brief), (b) [Master Plan v2](../vehicle_no_code_studio_master_plan_v2.md) R1–R16, (c) bổ sung từ research [00](00-research-findings.md).
> Mỗi yêu cầu có ID ổn định; ADR và phase tham chiếu bằng ID này. Ma trận truy vết ở §5.

---

## 1. Tầm nhìn sản phẩm

**SimVehicleApp** là một *vehicle no-code toolchain*: người dùng kéo-thả block đại diện tín hiệu **VSS** và logic để tạo workflow; hệ thống **biên dịch tất định** workflow sang Vehicle App **Eclipse Velocitas** (C++ trước, Python/Rust sau), build/run trên môi trường Velocitas chạy trong Docker, và trả log/tín hiệu runtime về UI. Người dùng có thể mở IDE (VS Code server) trên chính project đó, hoặc tải project về như một `vehicle-app-<lang>-template` đã được tuỳ biến.

Luồng chuẩn (brief của PO):
```
[UI] -> [kéo thả define logic theo block workflow] -> [verify + run compiler-code-<lang>]
     -> [đẩy vehicle app vào Velocitas project] -> [velocitas build/run]
     -> [trả kết quả về UI: log + tín hiệu runtime]
```

---

## 2. Functional Requirements

### 2.1 Nền tảng & đóng gói
| ID | Yêu cầu | Ưu tiên | Nguồn |
|---|---|---|---|
| FR-PLT-01 | Tái sử dụng SimStudioAI (Apache-2.0), refactor & rebrand thành **SimVehicleApp** | P0 | PO |
| FR-PLT-02 | **Chỉ một mode chạy: Docker Compose**. Không cần devcontainer (cả cho Sim lẫn Velocitas) | P0 | PO |
| FR-PLT-03 | Hệ thống tổ chức **monorepo gồm nhiều repo con độc lập** (meta-repo + sub-repo), sau này thêm repo con khác vẫn chạy bằng container | P0 | PO |
| FR-PLT-04 | **Backend nhiều tầng, độc lập nhau**: `compiler-code-<lang>`, IDE (VS Code server), Velocitas stack… mỗi cái là **repo con độc lập** (Dockerfile, version, CI, contract riêng) nhưng **có mặt đầy đủ** trong hệ thống (pin theo lock) | P0 | PO (bổ sung) |
| FR-PLT-05 | Mỗi "ô" trong luồng chuẩn là một module độc lập, giao tiếp qua **contract có version** | P0 | PO |
| FR-PLT-06 | UI tái sử dụng một phần Sim; loại bỏ phần không cần thiết (AI agent blocks, marketplace, integrations, billing, enterprise) | P0 | PO |

### 2.2 Vehicle Model & Blocks
| ID | Yêu cầu | Ưu tiên | Nguồn |
|---|---|---|---|
| FR-VSS-01 | Nạp VSS (JSON release COVESA; mặc định v4.0), phân loại `sensor/actuator/attribute/branch`, kèm datatype/unit/min/max/allowed | P0 | R4, PO |
| FR-VSS-02 | Đổi file/version VSS → toolbar cập nhật **không rebuild frontend** | P0 | R4 |
| FR-VSS-03 | Hỗ trợ VSS overlay (custom OEM signals) | P2 | đề xuất |
| FR-BLK-01 | **Block Sensor**: đọc 1 VSS path (sensor/attribute/actuator-current) | P0 | PO |
| FR-BLK-02 | **Block Actuator**: ghi 1 VSS actuator; write vào sensor bị chặn | P0 | PO, R5 |
| FR-BLK-03 | **Block Trigger**: signal changed (any/rising/falling/threshold-cross), timer, app start, MQTT message, condition becomes true | P0 | PO+đề xuất |
| FR-BLK-04 | **Block Logic** tương đương các cấu trúc có trong code: so sánh, boolean, toán học, map/scale, clamp, hysteresis, biến trạng thái, counter, expression | P0 | PO |
| FR-BLK-05 | **Flow control**: if/else, switch, wait (delay), wait-until (timeout), stable-for, repeat N, while (có guard), periodic loop, parallel + join, stop | P0/P1 | PO, R6 |
| FR-BLK-06 | **Communication**: MQTT publish/subscribe, HMI notify, Log (info/warn/error) | P0 | PO |
| FR-BLK-07 | **Semantic multi-VSS block** (curated) | P2 | R5 |
| FR-BLK-08 | gRPC service call, sub-workflow/function, state machine | P2/P3 | R11 |
| FR-BLK-09 | Block SDK + quy trình thêm block (< 1 ngày/block) | P1 | R16 |

### 2.3 Workflow & Compiler
| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-WF-01 | Kết nối block thành workflow từ cơ bản đến phức tạp (event-driven, delayed, conditional, parallel, loop) | P0 |
| FR-WF-02 | Validate realtime trên canvas (lint) + validate đầy đủ khi Verify | P0 |
| FR-WF-03 | Compile tất định `graph → IR → source`; cùng input ⇒ output byte-for-byte | P0 |
| FR-WF-04 | Diagnostics có mã ổn định, trỏ về `blockId`; lỗi compile C++ map ngược về block | P0/P1 |
| FR-WF-05 | Nhiều workflow trong 1 project → 1 Vehicle App | P0 |
| FR-WF-06 | Kiểm tra `modelHash` (VSS đổi sau khi thiết kế) | P1 |

### 2.4 Code generation (compiler-code-<lang>)
| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-CG-01 | `compiler-code-cpp` sinh C++ cho Velocitas C++ template (SDK 0.7.1, Conan 2) | P0 |
| FR-CG-02 | Đổi ngôn ngữ = đổi module `compiler-code-<lang>` (contract chung, không sửa canvas/compiler) | P0 (kiến trúc) |
| FR-CG-03 | `compiler-code-python` | P2 |
| FR-CG-04 | `compiler-code-rust` (feasibility → implement) | P3 |
| FR-CG-05 | AppManifest sinh/merge idempotent (v3) | P0 |
| FR-CG-06 | Generated code nhỏ, gọi runtime library viết tay | P0 |
| FR-CG-07 | Không dùng LLM trong đường sinh code | P0 |

### 2.5 Build / Run / Debug
| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-RUN-01 | **Simulate** (không build): chạy IR với virtual clock + giá trị giả lập | P0 |
| FR-RUN-02 | **SynCode**: generate → ghi vào Velocitas project → build (`velocitas`/Conan/CMake) → unit test | P0 |
| FR-RUN-03 | **Live Run headless**: chạy app đã build với KUKSA Databroker + MQTT (+ mock provider) trong Docker, **không cần mở IDE** | P0 |
| FR-RUN-04 | UI xem **log runtime**, **tín hiệu VSS realtime**, **trace block** (highlight block đang chạy trên canvas) | P0/P1 |
| FR-RUN-05 | UI inject giá trị sensor (thay cho feeder thật) | P0 |
| FR-RUN-06 | Stop/restart run; lịch sử run | P1 |
| FR-RUN-07 | Semantic parity: simulator vs binary thật | P1 |

### 2.6 IDE & Export
| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-IDE-01 | Mở **VS Code server** (code-server) ngay trong SimVehicleApp, đúng project, **có sẵn môi trường Velocitas** (CLI, Conan, CMake, SDK) | P0 |
| FR-IDE-02 | Trong IDE build/run được app với runtime stack của hệ thống | P1 |
| FR-EXP-01 | **Download** project (vehicle app + môi trường Velocitas) như một `vehicle-app-<lang>-template` tuỳ biến được | P0 |
| FR-EXP-02 | Export chịu **license/entitlement**: trước mắt *full quyền*, nhưng kiến trúc phải có điểm chặn license | P0 (hook) / P2 (enforce) |

### 2.7 AI Assistant
| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-AI-01 | **Thay toàn bộ luồng AI hiện tại** của Sim bằng **khung chat** | P0 |
| FR-AI-02 | API key LLM cấu hình từ `.env` (Anthropic, OpenAI, Gemini, Ollama, OpenAI-compatible…) | P0 |
| FR-AI-03 | Tích hợp **MCP**: (a) SimVehicleApp expose MCP server (tools thao tác workflow/VSS/run), (b) chat kết nối MCP server ngoài cấu hình từ `.env` | P0/P1 |
| FR-AI-04 | Prompt → sinh workflow (dưới dạng patch, user duyệt) | P0 |
| FR-AI-05 | Prompt → điều khiển workflow (validate, simulate, syncode, run, stop, đọc log) với xác nhận cho hành động có side-effect | P1 |

---

## 3. Non-Functional Requirements
| ID | Yêu cầu | Chỉ số đo |
|---|---|---|
| NFR-01 Determinism | Cùng graph + cùng version compiler/backend ⇒ cùng bytes | golden test diff = 0 |
| NFR-02 Performance | Validate < 300 ms (≤ 200 block); Simulate start < 1 s; SynCode incremental build < 60 s (cache ấm), cold < 10 phút (lần đầu, image đã bake cache) | benchmark CI |
| NFR-03 Reliability | Ghi workspace atomic; build fail không phá project | fault-injection test |
| NFR-04 Security | Path traversal chặn; service nội bộ không expose; secret chỉ ở `.env`; container non-root | security checklist |
| NFR-05 Offline | Build được khi không có internet sau khi image đã bake (VELOCITAS_OFFLINE) | CI job no-network |
| NFR-06 Maintainability | Module độc lập; không import chéo code giữa module (chỉ qua `simvehicleapp-contracts`) | dependency-cruiser/lint rule |
| NFR-07 License | Không mã AGPL/Enterprise trong sản phẩm; NOTICE đầy đủ | license scan CI |
| NFR-08 Observability | `generationId`/`runId` xuyên suốt log; metrics từng stage | log correlation test |
| NFR-09 Portability | Chạy trên Linux x86_64 & WSL2; arm64 best-effort | CI matrix |
| NFR-10 Safety boundary | UI hiển thị rõ: app cấp cao trên KUKSA, không thay hệ thống an toàn ASIL | UI review |
| NFR-11 Usability | Người không biết C++ tạo được workflow "Overspeed warning" < 10 phút | usability test |

---

## 4. Ngoài phạm vi (v1.0)
- Firmware ECU/CAN thật, safety-critical control loop.
- Deploy OTA thật (Kanto/Pantaris) — P3, qua `runtime-kanto` nếu cần.
- Multi-tenant SaaS quy mô lớn (P3), billing.
- LLM sinh C++ (cấm vĩnh viễn trong pipeline).

---

## 5. Ma trận truy vết (Requirement → ADR → Milestone)

| Requirement | ADR | Milestone (xem [roadmap](13-implementation-roadmap.md)) |
|---|---|---|
| FR-PLT-01, 06 | ADR-0003, 0004, 0008 | M1 |
| FR-PLT-02 | ADR-0005, 0025 | M0, M7 |
| FR-PLT-03, 04, 05 | ADR-0002, 0007 | M0 |
| FR-VSS-* | ADR-0010 | M2 |
| FR-BLK-* | ADR-0011, 0012, 0013 | M2, M3 |
| FR-WF-* | ADR-0014, 0015, 0016 | M4 |
| FR-CG-01, 02, 05, 06 | ADR-0020, 0021, 0022, 0023 | M6, M7 |
| FR-CG-03, 04 | ADR-0040, 0041 | M12, M13 |
| FR-RUN-01 | ADR-0017 | M5 |
| FR-RUN-02 | ADR-0006, 0025, 0026 | M7 |
| FR-RUN-03..06 | ADR-0024, 0027 | M8 |
| FR-RUN-07 | ADR-0042 | M11 |
| FR-IDE-* | ADR-0028 | M9 |
| FR-EXP-* | ADR-0031 | M9 |
| FR-AI-* | ADR-0030 | M10 |
| NFR-* | ADR-0007, 0032, 0033 | M11 |

Master Plan v2 R1–R16 ánh xạ: R1→FR-PLT-02; R2→FR-IDE-01; R3→FR-BLK-*; R4→FR-VSS-02; R5→FR-BLK-01/02/07; R6→FR-WF-01; R7→[06 UI](05-blocks-and-execution-model.md#ui); R8→FR-CG-01/05; R9→FR-IDE-01; R10→FR-CG-02; R11→FR-BLK-08; R12→FR-WF-02/04; R13→FR-RUN-02; R14→FR-RUN-03; R15→FR-RUN-07 + E2E; R16→FR-BLK-09.

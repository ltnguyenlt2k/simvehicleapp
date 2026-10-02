# Vehicle No-Code Studio — Master Architecture & Implementation Plan (v2)
## Bản tổng hợp chi tiết dành cho AI Coding Agent

**Base document:** `vehicle_no_code_studio_architecture_implementation_plan.md` (bản gốc, 100 mục, đã review đầy đủ)
**Baseline UI/workflow:** `simstudioai/sim`, tag tham chiếu `v0.7.13` (repo hiện tại đã lên tới `v0.7.26+`, agent PHẢI pin đúng version khi bắt đầu — xem §0)
**Vehicle App baseline:** `eclipse-velocitas/vehicle-app-cpp-template` (Conan 2, C++ SDK ≥ 0.7.0, CLI ≥ v0.13.2)
**Web IDE:** `code-server`
**Ngày biên soạn bản v2:** 2026-08-11
**Không mục nào trong bản gốc bị loại bỏ** — mọi phần được giữ lại, làm rõ hơn, bổ sung dữ kiện đã verify qua nguồn chính thức (GitHub, Eclipse Velocitas docs), và tổ chức lại để một AI coding agent có thể triển khai tuần tự, có gate kiểm tra ở mỗi bước.

---

## Cách đọc tài liệu này (dành cho AI Agent)

1. Đọc toàn bộ Part 0 → Part 3 trước khi viết bất kỳ dòng code nào — đây là "constitution" của hệ thống.
2. Thực hiện đúng thứ tự Phase ở **Part 9** (Detailed Implementation Phases). Không nhảy phase.
3. Mỗi Phase có: Mục tiêu → Input → Deliverables → File/Directory contract → API/Schema contract → Test bắt buộc → Definition of Done (DoD) → Acceptance Gate.
4. Nếu một Phase FAIL ở Acceptance Gate, KHÔNG được chuyển sang Phase kế tiếp. Phải quay lại sửa và re-run gate.
5. Sau mỗi Phase, tạo report theo template ở **Appendix D**.
6. Không dùng LLM để sinh C++ production code (xem Nguyên tắc #3, Part 3.3). LLM/AI chỉ được dùng ở các điểm liệt kê rõ ràng trong Part 3.3.
7. Khi có mâu thuẫn giữa tài liệu này và thực tế source code hiện tại của `sim` hoặc `vehicle-app-cpp-template` tại thời điểm implement — **ưu tiên source code thực tế**, và agent phải note lại sai khác đó trong ADR (Part 8.2).

---

# PART 0 — Dữ kiện đã verify từ nguồn chính thức (research findings)

Phần này bổ sung so với bản gốc: các dữ kiện dưới đây đã được xác nhận qua tra cứu trực tiếp GitHub và tài liệu Eclipse Velocitas tại thời điểm 2026-08-11, để giảm rủi ro AI agent "hallucinate" cấu trúc file.

## 0.1 SimStudioAI (`simstudioai/sim`)

- Repo mô tả hiện tại: "Sim is the collaborative workspace to build, deploy, and monitor AI agents and workflows." Đây là nền tảng workflow AI-agent, không phải công cụ automotive — đúng như giả định của bản gốc, cần refactor sâu.
- Cấu trúc xác nhận tồn tại:
  - `apps/sim/blocks/registry.ts` — registry ánh xạ `blockType -> BlockConfig`.
  - `apps/sim/blocks/registry-maps.ts` — các map phụ trợ cho registry.
  - `apps/sim/blocks/blocks/` — thư mục chứa từng block riêng lẻ (ví dụ `pinecone.ts`), mỗi provider một file.
  - `apps/sim/blocks/index.ts` — nơi export toàn bộ block ra ngoài (tương tự central export).
  - `apps/sim/tools/<provider>/` — mỗi block thường đi kèm một hoặc nhiều "tool" thực thi logic (fetch.ts, generate_embeddings.ts...), cộng với `types.ts`.
  - `apps/sim/tools/index.ts` — tool registry.
  - `apps/sim/components/icons.tsx` — nơi định nghĩa icon cho block (naming convention `<Provider>Icon`).
  - `apps/sim/app/api/custom-blocks/route.ts` — tồn tại API route cho custom blocks (đáng chú ý: có thể tái sử dụng cơ chế "custom block" thay vì phải sửa registry lõi — cần agent khảo sát kỹ ở Phase 3).
- Quan trọng: repo dùng cụm từ "Register **Your** Block" trong `CONTRIBUTING.md` → xác nhận kiến trúc block là **pluggable theo thiết kế gốc**, rất thuận lợi cho chiến lược "không rewrite canvas, chỉ thêm block domain mới" của bản gốc (Part 4.1, Part 7).
- **Cảnh báo phiên bản:** dòng release hiện tại đã vượt xa v0.7.13 (đã thấy tag/log tới v0.7.26+, breaking refactors liên tục trong `registry.ts`, ví dụ commit "stop registry.ts reading BLOCK_REGISTRY at module scope"). => Agent PHẢI:
  1. Checkout đúng tag `v0.7.13`.
  2. Tạo branch `vehicle-studio/baseline` từ tag đó, KHÔNG rebase lên `main`.
  3. Ghi lại checksum/commit hash của tag vào `docs/BASELINE.md` (Phase 0).
  4. Không merge upstream changes tự động — mọi update từ upstream phải qua đánh giá thủ công (ADR riêng).

## 0.2 Eclipse Velocitas — `vehicle-app-cpp-template`

- Xác nhận cấu hình dự án nằm ở `.velocitas.json`, ví dụ field quan trọng:
  ```json
  {
    "packages": {
      "devenv-runtimes": "v3.1.0",
      "devenv-devcontainer-setup": "v2.1.0"
    },
    "components": [
      "runtime-local",
      "devcontainer-setup",
      "vehicle-signal-interface",
      "sdk-installer",
      "grpc-interface-support"
    ],
    "variables": {
      "language": "cpp",
      "repoType": "app",
      "appManifestPath": "app/AppManifest.json",
      "githubRepoId": "eclipse-velocitas/vehicle-app-cpp-template",
      "generatedModelPath": "./gen/vehicle_model"
    },
    "cliVersion": "v0.13.2"
  }
  ```
  → `appManifestPath` mặc định là `app/AppManifest.json` (đúng chỗ, khác nhẹ so với suy đoán ban đầu `app/src/...`). Workspace Service (Part 6) PHẢI đọc path này từ `.velocitas.json` thay vì hard-code.
- **AppManifest thực tế dùng `manifestVersion: "v3"`**, với cấu trúc `interfaces[]`, mỗi interface có `type` thuộc tập:
  - `vehicle-signal-interface` — chứa `config.src` (URL/label VSS release, ví dụ `vss_rel_3.0.json`) và `config.datapoints.required[]` / `config.datapoints.provided[]`, mỗi datapoint có `path`, `access` (`read`/`write`), `optional`.
  - `grpc-interface` — chứa `config.src` (proto), `config.required.methods[]`.
  - `pubsub` — chứa `config.reads[]`, `config.writes[]` (MQTT topics).
  Ví dụ thật (rút gọn, paraphrase từ doc chính thức):
  ```json
  {
    "manifestVersion": "v3",
    "name": "SampleApp",
    "interfaces": [
      {
        "type": "vehicle-signal-interface",
        "config": {
          "src": "https://github.com/COVESA/vehicle_signal_specification/releases/download/v3.0/vss_rel_3.0.json",
          "datapoints": {
            "required": [
              { "path": "Vehicle.Speed", "optional": "true", "access": "read" }
            ],
            "provided": [
              { "path": "Vehicle.Cabin.Seat.Row1.Pos1.Position" }
            ]
          }
        }
      },
      {
        "type": "grpc-interface",
        "config": {
          "src": "https://.../seats.proto",
          "required": { "methods": ["Move", "MoveComponent"] }
        }
      },
      {
        "type": "pubsub",
        "config": {
          "reads": ["sampleapp/getSpeed"],
          "writes": ["sampleapp/setSpeed"]
        }
      }
    ]
  }
  ```
  → Đây là cơ sở chính xác cho **Phase 16 (Manifest Analyzer)** và **Phase 32 (AppManifest Generation)**: bộ sinh AppManifest của Vehicle No-Code Studio phải merge-in đúng 3 loại interface trên, giữ nguyên các interface không do workflow quản lý (idempotent merge, không overwrite toàn bộ file).
- Velocitas CLI hỗ trợ lệnh `velocitas package <name>` để inspect version của từng component, và `velocitas exec runtime-local run-vehicledatabroker` để chạy KUKSA Databroker local — Builder/Verification Service (Phase 18) nên tái sử dụng đúng các lệnh CLI này thay vì tự viết script chạy databroker riêng, để tránh drift với toolchain chính thức.
- SDK C++ (`vehicle-app-cpp-sdk`) ví dụ nằm trong `examples/` (vd. `seat-adjuster`, `set-data-points`) — Phase 15 (C++ Backend MVP) nên dùng các ví dụ này làm "reference implementation" khi viết Runtime Adapter (Part 6.4), để đảm bảo API gọi đúng (subscribe/get/set datapoint, gRPC service client) khớp với SDK thật, không phải suy đoán.
- Conan 2 là bắt buộc cho các version SDK mới (`>= v0.7.0`); template cũ dùng Conan 1 không tương thích. Generation Manifest / build verification (Phase 18) phải target Conan 2 profile.

## 0.3 Hệ quả đối với bản gốc

Các phần dưới đây của bản gốc **giữ nguyên định hướng, chỉ hiệu chỉnh chi tiết path/schema**:
- Part 6 (AppManifest phải là một phần của SynCode gốc) → cập nhật đúng field `manifestVersion: v3`, 3 interface type.
- Part 29 (C++ Output Structure gốc) → xác nhận root app tại `app/`, không phải `app/src` cho AppManifest; source code app vẫn nằm trong `app/src/` theo convention template — Workspace Service cần đọc cấu trúc thật lúc runtime thay vì hard-code, xem Phase 4/17.
- Part 41 (Opening the Generated Project gốc) → code-server phải mở đúng workspace root chứa `.velocitas.json`, không phải subfolder.

---

# PART 1 — Executive Summary (giữ nguyên tinh thần bản gốc, bổ sung rõ contract)

Mục tiêu: biến SimStudioAI (`v0.7.13` làm baseline) thành **Vehicle Application No-Code Studio**: người dùng kéo-thả block sinh từ Vehicle Model/VSS để tạo workflow logic cho Vehicle App, sau đó nhấn **SynCode** để hệ thống sinh C++ hợp lệ, verify bằng compiler/test thật, rồi commit atomically vào workspace `vehicle-app-cpp-template`, và mở code-server đúng project đó.

Luồng end-to-end (không đổi so với bản gốc, đã re-confirm khả thi với dữ kiện §0):

```
Vehicle Model/VSS
   -> Vehicle Model Catalog
   -> Dynamic Block Catalog (Toolbar) + Validator
   -> SimStudio Canvas (workflow graph)
   -> Frontend Compiler (graph -> Canonical IR)
   -> Backend (IR -> C++; Python/Rust sau này)
   -> Verification Pipeline (format + compile + tests)
   -> Workspace Service (atomic write vào shared volume)
   -> code-server mở đúng project
   -> user tiếp tục dùng Velocitas CLI để build/run/debug
```

**Quyết định kiến trúc quan trọng nhất (không đổi, là nguyên tắc tối thượng):**
KHÔNG generate C++ trực tiếp từ workflow JSON của canvas. Luồng bắt buộc là `workflow -> validation -> canonical IR -> language backend -> generated source`. IR là hợp đồng (contract) giữa phần no-code (product/UX layer) và phần sinh mã theo ngôn ngữ (compiler/codegen layer).

---

# PART 2 — Phạm vi & yêu cầu hệ thống (giữ nguyên, gom lại thành checklist kiểm tra được)

| # | Yêu cầu | Đo lường bằng |
|---|---|---|
| R1 | Sim + code-server chạy containerized, cùng shared volume | `docker compose up` chạy được, cả 2 container thấy cùng file |
| R2 | `vehicle-app-cpp-template` nằm trong workspace code-server mở được | code-server URL trỏ đúng folder chứa `.velocitas.json` |
| R3 | Toolbar có nhóm: Sensor / Actuator / Trigger / Logic / Flow Control / Service | UI test snapshot |
| R4 | Sensor/Actuator sinh từ VSS, không hard-code toàn bộ | Đổi VSS file → toolbar tự đổi theo, không cần build lại frontend |
| R5 | Có block đại diện 1 VSS path và block semantic gộp nhiều VSS path | Golden test case cho cả 2 loại |
| R6 | Kéo/thả/nối block thành workflow, hỗ trợ event-driven/delayed/conditional/parallel | Golden workflow corpus (Part 7.9) pass |
| R7 | `SynCode` nằm cạnh Run/Debug/Delete | UI test |
| R8 | SynCode sinh source đúng vào Velocitas project | Diff kiểm tra path sinh ra khớp `appManifestPath`/`app/src` |
| R9 | code-server mở project sau khi generate thành công | E2E test (Phase 26) |
| R10 | C++ là backend đầu tiên, kiến trúc hỗ trợ thêm Python/Rust sau | Backend interface có ≥ 1 implementation khác ngoài C++ ở mức "feasibility spike" (Phase 30) |
| R11 | Service có 2 mode: inline/library và standalone application | 2 golden workflow, mỗi mode 1 cái |
| R12 | Có validation/type checking/VSS checking | Diagnostics engine test suite |
| R13 | Có compile verification | CI job build thật bằng `velocitas` CLI + Conan 2 |
| R14 | Có integration test | Chạy được với KUKSA Databroker mock/local |
| R15 | Có E2E verification | Phase 26/63 |
| R16 | Dễ thêm block mới sau này | `ADD_NEW_BLOCK.md` + Block SDK, đo bằng thời gian thêm 1 block mẫu < X giờ |

---

# PART 3 — Nguyên tắc thiết kế bắt buộc (giữ nguyên 5 nguyên tắc gốc, làm rõ actionable rule)

## 3.1 Canvas không phải compiler
- Canvas: visual representation, block creation/property editing, edge creation, save/load graph, debug visualization.
- Canvas KHÔNG được chứa cú pháp C++/Python/Rust hay chi tiết Velocitas SDK.
- **Rule kiểm tra được:** grep toàn bộ `apps/sim/blocks/**` sau khi implement — không được có chuỗi như `std::`, `#include`, `velocitas::` xuất hiện trong code định nghĩa block (chỉ được phép trong `simulator.ts`/comment mô tả, không phải trong compiler opcode path).
- Block UI chỉ cung cấp **semantic intent**: ví dụ `Delay 300 seconds`, không phải `std::this_thread::sleep_for(...)`.

## 3.2 Workflow graph không phải target source AST
- Graph là representation phía người dùng; Compiler PHẢI normalize thành IR trước khi bất kỳ backend nào đọc.
- Ví dụ graph: `SignalChanged -> Delay -> Read -> Compare -> Actuator`
- IR diễn đạt semantic tương ứng bằng opcode: `event.vehicle_signal_changed`, `control.capture`, `control.delay`, `vehicle.read`, `logic.compare`, `vehicle.write`.
- Backend C++ tự quyết định cách hiện thực timer/subscription/callback — đây là **trách nhiệm của backend + runtime**, không phải của IR hay canvas.

## 3.3 Code generation phải deterministic — ranh giới sử dụng AI rõ ràng

**Sai (cấm tuyệt đối):**
```
workflow JSON -> prompt AI model -> C++ code
```

**Đúng (bắt buộc):**
```
workflow -> deterministic compiler -> IR -> deterministic backend -> C++ code
```

AI/LLM **chỉ được phép** dùng ở các điểm sau, tách biệt hoàn toàn khỏi pipeline sinh production code:
1. Suggest workflow structure cho người dùng (draft, không tự động apply).
2. Explain error/diagnostic bằng ngôn ngữ tự nhiên (không thay đổi kết quả validate).
3. Convert natural-language requirement → draft workflow graph (người dùng phải review/edit trước khi SynCode).
4. Sinh documentation phụ trợ.
5. Optional: giải thích code đã sinh (không sửa code).

**Rule kiểm tra được:** Codegen Service (Phase 15/19) không được có bất kỳ HTTP call nào tới LLM API trong request path của `SynCode`. Việc này enforce bằng: (a) network policy của container Codegen Service (egress chỉ tới KUKSA/registry nội bộ, không tới LLM endpoint), (b) code review checklist ở Phase 19.

## 3.4 Generated code phải nhỏ, runtime phải ổn định
- Các phần phức tạp (timers, scheduling, subscriptions, cancellation, logging, workflow lifecycle, vehicle access, service communication, async/concurrency) nằm trong **Runtime Library viết tay** (Part 6.4), KHÔNG sinh lại mỗi lần generate.
- Generator chỉ sinh: state machine + application logic cụ thể của từng workflow (gọi vào runtime API).
- Lợi ích: ít code sinh ra hơn → ít biến thể → compile ổn định → test đơn giản hơn → dễ thêm backend mới → sửa bug runtime một lần, áp dụng cho mọi workflow đã sinh trước đó (chỉ cần rebuild, không cần re-generate).

## 3.5 Không để code-server làm Codegen Service
- Sai: `Sim -> undocumented VS Code API -> tạo file trực tiếp trong code-server`.
- Đúng: `Sim -> Compiler/Codegen Service -> Workspace Service -> shared volume`; `code-server -> cùng shared volume` (đọc lại từ filesystem, không qua API riêng).
- Sau khi generate xong: `Sim -> mở URL code-server` (chỉ là điều hướng trình duyệt, không phải API tạo file).

## 3.6 (Bổ sung mới) Idempotency & Reproducibility
- Cùng một workflow graph (cùng hash) + cùng version compiler/backend → PHẢI luôn sinh ra byte-for-byte cùng một output (trừ timestamp/generationId trong metadata riêng biệt, không lẫn vào source).
- Đây là điều kiện tiên quyết để làm golden tests (Part 7.9) và Deterministic Build Identity (Part 8.7 / mục 87 bản gốc).

---

# PART 4 — Vai trò ba hệ thống nền (giữ nguyên, rút gọn + tham chiếu §0)

## 4.1 SimStudioAI v0.7.13 — giữ lại phần gì
Giữ lại: visual workflow canvas, block configuration model, block registry (`apps/sim/blocks/registry.ts`), workflow store (`apps/sim/stores/workflows/`), blocks+edges representation, workflow CRUD, executor (`apps/sim/executor/`, gồm `dag/`, `execution/`, `handlers/`), UI interaction, authentication/workspace (nếu cần multi-user).
→ **Không rewrite canvas từ đầu.** Xem Phase 2 (Disable AI-specific surface) và Part 5 (Refactor SimStudioAI) để biết chính xác cái gì bỏ/giữ/migrate.

## 4.2 Eclipse Velocitas Vehicle App
Velocitas Vehicle App không phải raw CAN application — nó làm việc với: generated vehicle model, Vehicle App SDK, query/subscription abstraction, KUKSA Databroker/vehicle abstraction, gRPC service interfaces, pub/sub interfaces. VSS mô tả semantic vehicle data; Velocitas AppManifest (`manifestVersion: v3`, xem §0.2) mô tả functional interfaces của application. Điều này khớp trực tiếp với mô hình no-code compiler (VSS path → block; AppManifest interface → auto-derived từ workflow).

## 4.3 code-server
Vai trò: web IDE — file explorer, terminal, Git, CMake/build usage, Velocitas CLI/dev environment, inspect generated source, debug/manual extension.
KHÔNG phải: workflow compiler, source-of-truth, filesystem API cho Sim gọi vào.

---

# PART 5 — Vehicle Model Catalog, Block Architecture, Toolbar

## 5.1 Vehicle Model Source abstraction

```ts
interface VehicleModelSource {
  load(): Promise<RawVehicleModel>;
  getVersionTag(): Promise<string>;      // hash hoặc version string của model
  watch?(onChange: (v: RawVehicleModel) => void): Unsubscribe; // optional, cho hot-reload dev mode
}
```

Không hard-code hệ thống vào đúng một tên file `datamodel.json`. Implementations cụ thể (đều implement interface trên):
- `LocalFileVehicleModelSource` — đọc VSS JSON từ path cấu hình (mặc định trỏ theo `generatedModelPath` trong `.velocitas.json`, xem §0.2).
- `HttpVehicleModelSource` — tải từ URL release COVESA VSS (ví dụ `vss_rel_3.0.json`), có cache + version pin.
- `GitVehicleModelSource` (P2) — theo dõi 1 branch/tag của repo VSS custom OEM.

## 5.2 Vehicle Model Catalog (service nội bộ, không phải chỉ là parser)

Trách nhiệm:
1. Parse VSS raw (JSON/YAML tuỳ COVESA export) thành `VehicleModelNode[]` có cấu trúc cây (namespace path, ví dụ `Vehicle.Speed`, `Vehicle.Cabin.Seat.Row1.Pos1.Position`).
2. Phân loại mỗi node theo COVESA rule set: `sensor` (read-only), `actuator` (read-write), `attribute` (static), `branch` (namespace container).
3. Gắn kèm: datatype (theo COVESA data types: `uint8`, `int32`, `float`, `double`, `boolean`, `string`, mảng tương ứng...), unit (theo COVESA units, ví dụ `km/h`, `percent`, `celsius`), min/max nếu có, description, deprecation flag.
4. Sinh **model hash** ổn định (ví dụ SHA-256 trên canonical JSON đã sort key) — dùng cho Part "Model Change Handling" (mục 67 gốc) và Deterministic Build Identity (mục 87 gốc).
5. Expose 2 consumer API:
   - `GET /vehicle-model/tree` — cho Toolbar (Dynamic Block Catalog).
   - `GET /vehicle-model/node/:path` — cho Compiler Validator tra cứu type/unit/access khi validate workflow.

## 5.3 Quy tắc Sensor/Actuator (giữ nguyên rule gốc, làm rõ)

- `sensor` → chỉ sinh **Read block** + **SignalChanged trigger block**. KHÔNG được phép có Write block cho path này (nếu workflow cố write vào sensor path → diagnostic `VEHICLE_WRITE_READ_ONLY`, xem Appendix B).
- `actuator` → sinh cả Read và Write block.
- `attribute` (static, không đổi theo thời gian) → chỉ sinh Read block, KHÔNG sinh trigger `SignalChanged` (vì không "change").
- `branch` → không sinh block trực tiếp, chỉ dùng để tổ chức cây trong UI Toolbar (thư mục/nhóm).

## 5.4 Hai kiểu Block Vehicle

1. **Single-VSS block**: 1 block ↔ 1 VSS path cụ thể (ví dụ `Vehicle.Speed`). Sinh tự động 100% từ catalog, không cần con người review.
2. **Semantic/Curated multi-VSS block**: 1 block đại diện nhiều VSS path liên quan chức năng (ví dụ block "Battery Status" gộp `Vehicle.Powertrain.TractionBattery.StateOfCharge.Current` + `...Displayed`). Đây là block **do con người curate** (P2, Phase 23), có file riêng theo Block Package structure (Appendix C), không sinh tự động — vì cần domain knowledge để nhóm đúng ngữ nghĩa.

## 5.5 Toolbar — nhóm block bắt buộc

| Nhóm | Nguồn sinh | Ví dụ |
|---|---|---|
| Sensor | Auto từ VSS (sensor/attribute) | Read Vehicle.Speed |
| Actuator | Auto từ VSS (actuator) | Write Vehicle.Cabin.Seat...Position |
| Trigger | Static, curated (không phụ thuộc VSS) + auto SignalChanged theo path | `event.vehicle_signal_changed`, `event.timer`, `event.app_start` |
| Logic | Static, curated | Compare, And/Or/Not, Threshold, Map/Transform |
| Flow Control | Static, curated | Delay, Stable For, Parallel, Join.All, Branch/If |
| Service | Static + config-driven | Call gRPC method, Publish/Subscribe pubsub, HMI notify |

## 5.6 Block SDK & Definition of Done cho 1 block

Mỗi block mới phải có đủ:
```
vehicle-blocks/<block-name>/
├── definition.ts       # schema, inputs/outputs, properties, compiler.opcode
├── semantics.md         # mô tả ngữ nghĩa bằng lời, edge cases
├── migration.ts         # nếu block có version > 1, migration từ version cũ
├── simulator.ts          # cách block hoạt động ở Run/Debug mode (mô phỏng)
└── <block-name>.test.ts  # unit test cho definition + simulator
```

Xem ví dụ đầy đủ ở **Appendix C**.

**Definition of Done cho 1 block:**
- [ ] `definition.ts` compile, đăng ký được vào registry (custom-blocks route hoặc registry chính, tuỳ Phase 3 quyết định).
- [ ] Có ít nhất 1 unit test cho mỗi property required.
- [ ] Có `semantics.md` mô tả rõ input/output/side-effect.
- [ ] Compiler có mapping `opcode` tương ứng trong IR spec (Part 6).
- [ ] Nếu là vehicle block: đã chạy qua Vehicle Model Catalog validation (đúng access sensor/actuator).
- [ ] Có simulator behavior để Run/Debug mode không bị crash khi gặp block này.
- [ ] Thêm vào Golden Workflow Corpus nếu là block P0/P1.

---

# PART 6 — Canonical Workflow IR, Type System, Unit System, Execution Semantics

## 6.1 Mục tiêu IR
IR là hợp đồng bắt buộc giữa Frontend Compiler (đọc graph) và Backend (sinh code). IR phải:
- Ngôn ngữ-độc lập (không chứa cú pháp C++/Python/Rust).
- Typed (mọi input/output có kiểu dữ liệu + unit rõ ràng).
- Versioned (semver riêng cho IR, độc lập với version của Sim hay backend).
- Serializable (JSON), có schema formal (JSON Schema) để validate tự động trong CI.

## 6.2 IR JSON Schema (rút gọn nhưng đầy đủ trường bắt buộc)

```json
{
  "$id": "https://vehicle-nocode-studio/schemas/ir/v1.json",
  "type": "object",
  "required": ["irVersion", "workflowId", "workflowRevision", "modelHash", "nodes", "edges", "metadata"],
  "properties": {
    "irVersion": { "type": "string", "const": "1.0.0" },
    "workflowId": { "type": "string" },
    "workflowRevision": { "type": "integer", "minimum": 1 },
    "modelHash": { "type": "string", "description": "hash của Vehicle Model dùng để compile" },
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "opcode", "inputs", "outputs", "properties", "sourceBlockId"],
        "properties": {
          "id": { "type": "string" },
          "opcode": { "type": "string", "description": "vd: event.vehicle_signal_changed, control.delay, vehicle.read, vehicle.write, logic.compare, control.parallel, control.join.all, service.grpc_call, service.pubsub_publish" },
          "inputs": { "type": "object" },
          "outputs": { "type": "object" },
          "properties": { "type": "object" },
          "type": { "type": "object", "description": "kiểu dữ liệu suy ra/khai báo cho input/output" },
          "unit": { "type": ["object", "null"] },
          "sourceBlockId": { "type": "string", "description": "traceability về block gốc trên canvas — bắt buộc cho Part 'Traceability' (mục 86 gốc)" }
        }
      }
    },
    "edges": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["from", "to", "kind"],
        "properties": {
          "from": { "type": "string" },
          "to": { "type": "string" },
          "kind": { "type": "string", "enum": ["data", "control"] }
        }
      }
    },
    "metadata": {
      "type": "object",
      "required": ["compilerVersion", "generatedAt", "sourceGraphHash"],
      "properties": {
        "compilerVersion": { "type": "string" },
        "generatedAt": { "type": "string", "format": "date-time" },
        "sourceGraphHash": { "type": "string" }
      }
    }
  }
}
```

## 6.3 Bảng Opcode chuẩn (P0, phải implement đủ trước khi qua Phase 15)

| Opcode | Ý nghĩa | Input | Output |
|---|---|---|---|
| `event.vehicle_signal_changed` | Trigger khi 1 VSS path đổi giá trị | `path`, `debounceMs?` | `value`, `timestamp` |
| `event.timer` | Trigger định kỳ | `intervalMs` | `tick` |
| `event.app_start` | Trigger khi app khởi động | — | — |
| `control.capture` | Chụp giá trị hiện tại để giữ qua các bước async | `value` | `capturedValue` |
| `control.delay` | Trì hoãn N giây/ms trước khi tiếp tục | `durationMs` | passthrough |
| `control.stable_for` | Chỉ tiếp tục nếu giá trị ổn định trong khoảng thời gian | `value`, `durationMs` | `value` (nếu ổn định) |
| `control.parallel` | Chạy nhiều nhánh song song | branches[] | — |
| `control.join.all` | Đợi tất cả nhánh song song hoàn tất | branches[] | merged outputs |
| `control.branch` | If/else theo điều kiện | `condition` | 1 trong 2 nhánh |
| `vehicle.read` | Đọc 1 VSS path | `path` | `value` |
| `vehicle.write` | Ghi 1 VSS path (chỉ actuator) | `path`, `value` | ack |
| `logic.compare` | So sánh 2 giá trị (`>`, `<`, `==`, `!=`, `>=`, `<=`) | `left`, `op`, `right` | `boolean` |
| `logic.and` / `logic.or` / `logic.not` | Boolean logic | booleans | `boolean` |
| `logic.map` | Transform giá trị (scale/offset/lookup) | `value`, `fn` | `value` |
| `service.grpc_call` | Gọi method gRPC provided/required trong AppManifest | `interface`, `method`, `args` | `result` |
| `service.pubsub_publish` / `service.pubsub_subscribe` | MQTT-style pub/sub | `topic`, `payload?` | ack / `payload` |

## 6.4 Type System
- Kiểu cơ bản map trực tiếp theo COVESA VSS data types: `uint8/16/32/64`, `int8/16/32/64`, `float`, `double`, `boolean`, `string`, và dạng mảng tương ứng.
- Kiểu suy diễn (inferred) cho output của logic block dựa trên input (ví dụ `logic.compare` luôn trả `boolean` bất kể input type).
- Type checking chạy ở Validation Level "Types" (Part 7.4) — lỗi kiểu phải chặn compile, không được "best effort cast" ngầm.

## 6.5 Unit System
- Đơn vị lấy theo COVESA VSS units (`km/h`, `percent`, `celsius`, `V`, `A`, `kWh`...).
- Khi 2 giá trị có cùng physical dimension nhưng khác unit (vd so sánh `km/h` với `mph`) → compiler **tự động chèn conversion node** vào IR (không chèn "âm thầm" vào generated code của backend — phải là 1 node IR tường minh, có `sourceBlockId` trỏ về compiler-inserted, để giữ traceability).
- Nếu 2 giá trị khác dimension hoàn toàn (vd so sánh `percent` với `celsius`) → diagnostic lỗi cứng, không cho compile.

## 6.6 Expressions
- Property dạng expression (vd ngưỡng động, công thức map) dùng 1 mini-expression language riêng, được compile tường minh thành sub-tree trong IR (không phải raw string nhét thẳng vào code sinh ra) — đảm bảo nguyên tắc 3.3 (deterministic, không string injection).

---

# PART 7 — Compiler Pipeline, Validation, Diagnostics, Simulator

## 7.1 Pipeline tổng thể

```
Workflow Graph (từ Sim canvas, JSON)
   -> [1] Structural validation (graph well-formed: no dangling edge, no orphan node...)
   -> [2] Block configuration validation (mọi property required đã điền, đúng kiểu)
   -> [3] Vehicle model validation (path tồn tại, đúng access sensor/actuator)
   -> [4] Type checking
   -> [5] Unit checking (+ auto-insert conversion nodes)
   -> [6] Control flow validation (không có cycle bất hợp lệ, parallel/join khớp cặp, mọi trigger có ít nhất 1 downstream action)
   -> [7] Backend capability check (opcode có backend hiện tại hỗ trợ không — vd C++ backend MVP có thể chưa support service.grpc_call ở Phase 15)
   -> Canonical IR (nếu qua hết 7 bước)
```

## 7.2 Diagnostics — format chuẩn (dùng xuyên suốt toàn hệ thống)

```json
{
  "code": "VEHICLE_WRITE_READ_ONLY",
  "severity": "error | warning | info",
  "blockId": "block-set-speed",
  "message": "Vehicle.Speed is a sensor and cannot be written.",
  "suggestion": "Choose a VSS actuator path."
}
```
Xem thêm ví dụ đầy đủ ở **Appendix B**. Danh mục mã lỗi tối thiểu P0 (agent bổ sung dần, không được đổi tên mã đã publish — breaking change cho UI hiển thị lỗi):

| Code | Level | Stage |
|---|---|---|
| `GRAPH_DANGLING_EDGE` | error | structural |
| `BLOCK_PROPERTY_MISSING` | error | block config |
| `VEHICLE_PATH_NOT_FOUND` | error | vehicle model |
| `VEHICLE_WRITE_READ_ONLY` | error | vehicle model |
| `TYPE_MISMATCH` | error | types |
| `UNIT_DIMENSION_MISMATCH` | error | units |
| `CONTROL_FLOW_CYCLE` | error | control flow |
| `PARALLEL_JOIN_UNMATCHED` | error | control flow |
| `TRIGGER_WITHOUT_ACTION` | warning | control flow |
| `OPCODE_UNSUPPORTED_BY_BACKEND` | error | backend capability |
| `MODEL_HASH_MISMATCH` | warning | vehicle model (model đã đổi từ lúc thiết kế workflow) |

## 7.3 Block Versioning & IR Versioning
- Mỗi block có `schemaVersion`. Khi thay đổi breaking, tăng version + viết `migration.ts` để tự động nâng cấp workflow cũ khi mở lại (không được silently break workflow đã lưu).
- IR có version riêng (`irVersion`, semver). Backend khai báo range IR version nó support. Compiler từ chối build nếu backend không support IR version hiện tại — lỗi rõ ràng, không cố "đoán" tương thích.

## 7.4 Simulator / Run-Debug Mode
- Chạy trực tiếp trên IR (không phải trên C++ đã sinh) → cho phép debug nhanh trước khi tốn thời gian compile thật.
- Dùng **Virtual Clock** cho các opcode có time semantics (`control.delay`, `control.stable_for`, `event.timer`) để test nhanh (vd "delay 300s" chạy tức thời trong simulator, có thể fast-forward).
- Vehicle values trong simulator dùng mock/injectable values do user nhập ở panel Run/Debug, không cần kết nối KUKSA Databroker thật.

---

# PART 8 — C++ Codegen Backend & Runtime Library

## 8.1 Nguyên tắc tách lớp
- **Runtime Library** (viết tay 1 lần, versioned riêng, ví dụ `libvehicle-studio-runtime`): chứa Vehicle Access Adapter, timer/scheduler, subscription manager, cancellation token, logging, workflow lifecycle base class, service communication helpers (gRPC client/server wrapper mỏng trên SDK thật, pub/sub wrapper).
- **Generated Code** (sinh mỗi lần SynCode): chỉ chứa state machine cụ thể của từng workflow + lời gọi vào Runtime Library API. Càng ít logic phức tạp trong generated code càng tốt (nguyên tắc 3.4).

## 8.2 Vehicle Access C++ Adapter — dùng đúng SDK thật
Tham chiếu bắt buộc: `vehicle-app-cpp-sdk` (ví dụ trong `examples/seat-adjuster`, `examples/set-data-points`) để đảm bảo API subscribe/get/set datapoint đúng thật, không suy đoán. Adapter interface tối thiểu:
```cpp
class IVehicleAccess {
public:
  virtual void subscribe(const std::string& path, std::function<void(const DataPointValue&)> onChange) = 0;
  virtual DataPointValue readOnce(const std::string& path) = 0;
  virtual void write(const std::string& path, const DataPointValue& value) = 0;
  virtual ~IVehicleAccess() = default;
};
```
Generated code chỉ gọi `IVehicleAccess`, không bao giờ gọi trực tiếp SDK thô — cho phép test bằng mock adapter (Phase 26 integration test) mà không cần Databroker thật chạy trong mọi CI job.

## 8.3 C++ Output Structure (đã hiệu chỉnh theo §0.2)

```
app/
├── AppManifest.json                  # merge tự động bởi Manifest Analyzer (Phase 16/32)
├── .velocitas.json                   # KHÔNG do Sim ghi đè, chỉ đọc
└── src/
    ├── generated/
    │   └── workflows/
    │       ├── <workflow-name>.hpp
    │       └── <workflow-name>.cpp
    ├── user/                         # vùng người dùng có thể tự viết tay, không bị overwrite khi re-generate
    └── runtime/                      # (nếu vendored) hoặc link tới libvehicle-studio-runtime qua Conan package riêng
```
- **Generated Code Ownership rule:** mọi file trong `generated/` có header comment "DO NOT EDIT — regenerated by SynCode" + hash của IR đã sinh ra nó. File trong `user/` không bao giờ bị Codegen Service động vào.

## 8.4 Generation Manifest
Mỗi lần SynCode thành công, ghi 1 file manifest kèm theo (ví dụ `generated/workflows/<name>.manifest.json`) chứa: `generationId`, `workflowRevision`, `modelHash`, `compilerVersion`, `irHash`, danh sách file đã sinh + checksum từng file. Dùng cho: (a) Atomic Generation rollback, (b) Deterministic Build Identity, (c) Generated Diff hiển thị cho user trước khi họ commit git.

## 8.5 AppManifest Generation/Update — merge, không overwrite
Thuật toán bắt buộc (idempotent merge):
1. Đọc AppManifest hiện tại (nếu chưa có → tạo mới `manifestVersion: v3`).
2. Từ IR, suy ra tập `requiredInterfaces` (vehicle-signal-interface datapoints, grpc-interface methods, pubsub topics) mà các workflow đang active cần.
3. Merge tập này vào interface list hiện có theo path/method/topic — không xoá entry nào mà workflow khác (ngoài hệ thống no-code) đã thêm thủ công, trừ khi entry đó có `"managedBy": "vehicle-nocode-studio"` marker và không còn workflow nào cần nó nữa (safe cleanup).
4. Ghi lại file, format lại (đảm bảo diff nhỏ, dễ review git).

## 8.6 Service Model — 2 deployment mode
- **Mode A — Inline/Library:** logic chạy trong cùng process app chính, gọi trực tiếp Runtime Library. Phù hợp workflow đơn giản.
- **Mode B — Standalone Vehicle App:** workflow sinh ra thành 1 Vehicle App riêng (project con, có AppManifest riêng), giao tiếp qua gRPC/pubsub với app chính. Dùng khi cần isolation, scale, hoặc khi nhiều workflow phức tạp cần lifecycle riêng.
- Quyết định mode do người dùng chọn ở Project Configuration UI (Part "Project Configuration UI", mục 42 gốc) mỗi workflow hoặc mỗi service block, không phải toàn hệ thống chỉ chọn 1 mode.

## 8.7 Concurrency & Reentrancy
- Mỗi workflow instance có 1 cancellation token; khi trigger bắn lại trong lúc workflow cũ đang chạy (vd `delay` chưa hết), Runtime Library áp dụng policy cấu hình được: `cancel-and-restart` (mặc định, khớp ví dụ "Stable Overspeed Brake") hoặc `ignore-while-running` hoặc `queue`.
- Policy này là property của **Trigger block** (không phải hard-code trong runtime), để user chọn được trên canvas — nhưng cơ chế thực thi vẫn nằm trong Runtime Library, không sinh riêng cho từng workflow.

---

# PART 9 — Detailed Implementation Phases (P0 → P3, có Gate)

> Mỗi phase dưới đây PHẢI kết thúc bằng report theo Appendix D và Acceptance Gate PASS trước khi sang phase kế.

## PHASE 0 — Baseline Freeze
- **Mục tiêu:** cố định baseline để mọi phase sau build trên nền ổn định.
- **Việc làm:** checkout `simstudioai/sim` tag `v0.7.13`; tạo branch `vehicle-studio/baseline`; checkout `eclipse-velocitas/vehicle-app-cpp-template` (main, ghi rõ commit hash); ghi cả 2 commit hash + ngày checkout vào `docs/BASELINE.md`.
- **Deliverable:** `docs/BASELINE.md`, 2 repo con (submodule hoặc vendored) trong monorepo studio.
- **Gate:** cả 2 repo build/run được ở trạng thái stock (chưa sửa gì) trước khi tiếp tục.

## PHASE 1 — Architecture Skeleton
- Tạo package boundaries (Part 10 dưới đây): `vehicle-model-catalog`, `compiler-core`, `ir-schema`, `backend-cpp`, `codegen-service`, `workspace-service`, `sim-frontend` (fork), `runtime-cpp` (thư viện riêng).
- **Gate:** mỗi package build rỗng (empty impl) nhưng dependency graph đúng chiều (xem Part 10.2 Dependency Rules — không cho phép `sim-frontend` import trực tiếp `backend-cpp`).

## PHASE 2 — Disable AI-specific product surface
- Tắt (feature-flag, không xoá) các phần AI-agent-workflow-specific không liên quan Vehicle App (marketplace AI tool blocks, LLM connector blocks, v.v.) theo danh sách Part 12 (Refactor SimStudioAI).
- **Gate:** app chạy được, UI không còn hiển thị block/tool không liên quan, nhưng code cũ vẫn còn trong repo (không mass-delete ở phase này).

## PHASE 3 — Block SDK
- Xây `definition.ts` schema chuẩn (theo Part 5.6), cơ chế đăng ký block mới — khảo sát dùng lại `apps/sim/app/api/custom-blocks/route.ts` đã có sẵn trong sim thay vì sửa `registry.ts` core (giảm rủi ro conflict khi cần merge upstream sau này).
- **Gate:** đăng ký thành công 1 block "hello world" test qua Block SDK, hiển thị đúng trên toolbar.

## PHASE 4 — Vehicle Model Catalog
- Implement `VehicleModelSource` (Part 5.1) + Catalog service (Part 5.2) đọc VSS json thật (dùng file COVESA VSS release làm fixture test, ví dụ `vss_rel_3.0.json` hoặc `vss_rel_4.x.json` — agent kiểm tra version mới nhất tại thời điểm implement).
- **Gate:** `GET /vehicle-model/tree` trả đúng cây, phân loại đúng sensor/actuator/attribute cho ≥ 20 path mẫu đã biết trước (test cố định, không đoán).

## PHASE 5 — Vehicle Model API
- Expose API cho cả Toolbar và Compiler Validator dùng chung 1 nguồn dữ liệu (không duplicate parser).
- **Gate:** cả 2 consumer gọi cùng 1 API, không có 2 bản parse VSS khác nhau trong hệ thống.

## PHASE 6 — Dynamic Toolbar
- Toolbar tự sinh block Sensor/Actuator từ Catalog API, group theo VSS namespace tree.
- **Gate:** đổi file VSS input (thêm/xoá 1 path) → toolbar cập nhật mà không cần rebuild frontend (chỉ cần Catalog service reload).

## PHASE 7 — Core Vehicle Blocks
- Read/Write block, SignalChanged trigger — cho cả single-VSS block.
- **Gate:** kéo thả tạo được 1 workflow tối thiểu Read→Write.

## PHASE 8 — Trigger & Logic Blocks
- Static curated blocks: timer, app_start, compare, and/or/not, map/threshold.
- **Gate:** unit test cho từng block simulator behavior.

## PHASE 9 — Flow Control
- Delay, Stable For, Parallel, Join.All, Branch.
- **Gate:** golden mini-workflow dùng đủ các flow control này chạy đúng trong Simulator (Part 7.4).

## PHASE 10 — IR v1
- Implement schema (Part 6.2) + serializer/deserializer + JSON Schema validation trong CI.
- **Gate:** IR JSON của mọi golden workflow validate PASS theo JSON Schema.

## PHASE 11 — Compiler Frontend
- Implement đủ 7 bước pipeline (Part 7.1): graph → IR.
- **Gate:** 2 golden workflow chuẩn (Part 11 dưới, "Stable Overspeed Brake", "Low Battery HMI Warning") compile ra IR đúng kỳ vọng (so khớp snapshot).

## PHASE 12 — Diagnostics Engine
- Implement toàn bộ mã lỗi P0 (Part 7.2 bảng).
- **Gate:** test case cố ý sai (write vào sensor, type mismatch, unit mismatch, cycle...) trả đúng mã lỗi tương ứng.

## PHASE 13 — Simulator
- Implement Virtual Clock + mock vehicle value injection.
- **Gate:** golden workflow chạy trong simulator cho ra đúng sequence sự kiện kỳ vọng (so snapshot trace).

## PHASE 14 — C++ Runtime Layer
- Implement `libvehicle-studio-runtime` (Part 8.1, 8.2): Vehicle Access Adapter, timer/scheduler, cancellation, logging, service comm helpers — dựa theo ví dụ thật trong `vehicle-app-cpp-sdk/examples`.
- **Gate:** runtime library build bằng Conan 2, có unit test riêng (không phụ thuộc code sinh ra), mock adapter hoạt động không cần Databroker thật.

## PHASE 15 — C++ Backend MVP
- IR → C++ cho tập opcode P0 (không cần `service.*` ở phase này — service để Phase 24/25).
- **Gate:** 2 golden workflow (Part 11 gốc mục 21, 22 / Part 97) sinh code build thành công bằng `velocitas` CLI thật trên `vehicle-app-cpp-template`.

## PHASE 16 — Manifest Analyzer
- Implement thuật toán merge AppManifest (Part 8.5), dựa đúng schema `manifestVersion: v3` đã verify ở §0.2.
- **Gate:** re-run SynCode 2 lần liên tiếp trên cùng workflow → AppManifest không đổi thêm lần thứ 2 (idempotent), diff git nhỏ gọn.

## PHASE 17 — Workspace Service
- Đọc `.velocitas.json` để biết đúng `appManifestPath`, `generatedModelPath`; ghi file atomically (staging dir → move) vào đúng cấu trúc Part 8.3.
- **Gate:** ghi thất bại giữa chừng (simulate crash) không để lại file half-written trong workspace thật (test bằng fault injection).

## PHASE 18 — Builder/Verification Service
- Wrap `velocitas` CLI thật: format (clang-format), compile (Conan 2 + CMake), test (integration test framework Velocitas).
- **Gate:** verification pipeline trả đúng object `verification: {ir, format, compile, tests}` như Appendix A, cho cả case pass và fail.

## PHASE 19 — SynCode Backend
- Ghép toàn bộ pipeline: graph → IR → C++ → verify → workspace write, atomic end-to-end, có `generationId` traceable.
- **Gate:** chạy full pipeline cho 2 golden workflow, trả response đúng format Appendix A.

## PHASE 20 — SynCode UI
- Nút SynCode cạnh Run/Debug/Delete; hiển thị diagnostics nếu fail (Appendix B format); hiển thị link mở code-server nếu pass.
- **Gate:** UI test end-to-end (mock backend) cho cả 2 nhánh pass/fail.

## PHASE 21 — code-server Container
- Docker image code-server, mount shared volume, mở đúng workspace root (chứa `.velocitas.json`).
- **Gate:** mở URL từ SynCode response → code-server hiển thị đúng file vừa generate.

## PHASE 22 — Full C++ Feature Coverage
- Hoàn thiện toàn bộ opcode bảng Part 6.3 cho C++ backend (bao gồm `service.*`).
- **Gate:** mọi opcode có ≥ 1 golden test.

## PHASE 23 — Curated Multi-VSS Blocks
- Xây quy trình con người curate block semantic gộp nhiều VSS path (Part 5.4 mục 2), có review process riêng (không auto-generate).
- **Gate:** ≥ 3 block mẫu (vd Battery Status, Climate Status, Door/Lock Status) đủ Definition of Done (Part 5.6).

## PHASE 24 — Inline Services
- Service Mode A (Part 8.6) hoàn thiện, generated code gọi Runtime Library service helpers.
- **Gate:** golden workflow dùng gRPC call qua inline mode build + test pass.

## PHASE 25 — Standalone Service Apps
- Service Mode B: sinh project con riêng với AppManifest riêng.
- **Gate:** golden workflow dùng standalone mode build thành 2 project độc lập, giao tiếp đúng qua interface đã khai báo.

## PHASE 26 — Full Runtime Integration Tests
- Chạy với KUKSA Databroker local thật (qua `velocitas exec runtime-local run-vehicledatabroker`), không chỉ mock.
- **Gate:** E2E test: canvas → SynCode → build thật → chạy app thật → publish giá trị giả lập vào Databroker → quan sát actuator write đúng kỳ vọng.

## PHASE 27 — Semantic Parity Test System
- So sánh hành vi Simulator (chạy trên IR) với hành vi binary C++ thật đã build, trên cùng input trace — đảm bảo compiler + backend không "nói dối" simulator.
- **Gate:** trace từ Simulator và trace từ binary thật khớp nhau cho toàn bộ Golden Workflow Corpus.

## PHASE 28 — Refactor Cleanup
- Xoá hẳn phần AI-agent-specific đã disable ở Phase 2 (sau khi chắc chắn không còn cần), dọn dependency thừa.
- **Gate:** không còn dead code liên quan sản phẩm AI-agent cũ; bundle size/build time cải thiện đo được.

## PHASE 29 — Python Backend (feasibility + implement, P3)
- Thêm 1 backend mới chỉ bằng cách implement lại interface Backend (không sửa canvas/compiler frontend) — đây là bài test thực tế cho tuyên bố "multi-language không cần rewrite" ở Executive Summary.
- **Gate:** 1 golden workflow build và chạy được bằng Python backend, tái sử dụng 100% compiler frontend hiện có.

## PHASE 30 — Rust Feasibility + Backend (P3)
- Tương tự Phase 29, đánh giá feasibility trước, sau đó implement nếu khả thi trong scope.
- **Gate:** báo cáo feasibility tối thiểu; nếu implement, cùng gate như Phase 29.

---

# PART 10 — Refactor SimStudioAI, Package Boundaries, Dependency Rules

## 10.1 Refactor SimStudioAI

| Giữ | Loại bỏ dần (sau Phase 28) | Không mass-delete ngay |
|---|---|---|
| Canvas, block registry mechanism, workflow store, executor/DAG, block SDK pattern, auth/workspace multi-user | AI-agent marketplace, LLM connector blocks, các tool block không liên quan automotive (Pinecone, v.v. dùng làm ví dụ minh hoạ pattern, không phải block thật cần giữ) | Database schema workflow cũ (migrate dần, không drop bảng ngay vì có thể còn dữ liệu người dùng cần) |

## 10.2 Package Boundaries & Dependency Rules

```
sim-frontend (canvas, toolbar, UI)
   -> depends on: vehicle-model-catalog (read API), compiler-core (qua API, không import trực tiếp code)
compiler-core (validation + IR)
   -> depends on: ir-schema, vehicle-model-catalog
backend-cpp
   -> depends on: ir-schema, runtime-cpp (biết API của nó để sinh lời gọi đúng)
codegen-service
   -> depends on: compiler-core, backend-cpp (và các backend khác qua interface chung), workspace-service
workspace-service
   -> depends on: filesystem/shared volume only, KHÔNG depends ngược lên codegen-service
runtime-cpp
   -> depends on: vehicle-app-cpp-sdk (external), KHÔNG depends lên bất kỳ package no-code nào (để có thể release độc lập, versioned riêng qua Conan)
```
**Rule cứng:** `sim-frontend` không bao giờ import trực tiếp `backend-cpp`. Mọi giao tiếp qua HTTP API của `codegen-service`. Vi phạm rule này là lỗi kiến trúc nghiêm trọng cần reject ở code review.

## 10.3 Capability Registry
- 1 registry trung tâm khai báo: backend nào support opcode nào, support IR version nào, support service mode nào — dùng bởi Validation Level 7 (Backend capability check, Part 7.1) để báo lỗi sớm thay vì để build fail mới biết.

---

# PART 11 — Testing Pyramid & Golden Workflow Corpus

## 11.1 Testing Pyramid
```
Unit          — mỗi block, mỗi opcode, mỗi validation rule
Golden        — snapshot IR + generated code cho tập workflow chuẩn cố định
Compile       — build thật bằng velocitas CLI + Conan 2
Integration   — chạy với KUKSA Databroker local
Semantic parity — Simulator trace vs binary thật trace
E2E           — canvas thao tác thật (Playwright-style) -> SynCode -> code-server mở đúng
```

## 11.2 Golden Workflow Corpus — 2 workflow bắt buộc đầu tiên (không dùng "hello world" làm chuẩn xác nhận đầu tiên)

**Workflow A — Stable Overspeed Brake**
Trigger `SignalChanged(Vehicle.Speed)` → `capture` → `stable_for(2000ms)` → `read` lại giá trị mới nhất → `compare(> threshold)` → nếu true → `write` actuator brake signal.
Validate được: signal subscription, state capture, cancellation/restart khi speed đổi liên tục, delay, read, comparison, đơn vị (km/h), actuator write.

**Workflow B — Low Battery HMI Warning**
`SignalChanged(Battery.StateOfCharge)` → `read` (percent) → `compare(< threshold)` → `service` output cảnh báo tới HMI (qua actuator hoặc service call tuỳ cấu hình).
Validate được: battery model lookup, percent unit, threshold logic, service/actuator output, user-facing warning logic.

Hai workflow này cùng exercise phần lớn semantics cốt lõi của hệ thống — dùng làm gate bắt buộc cho Phase 11, 15, 19, 26, 27.

## 11.3 CI Gates

| Gate | Khi nào chạy | Fail thì sao |
|---|---|---|
| Pull Request | mỗi PR | unit + golden snapshot + IR schema validate |
| Nightly/Main | hàng đêm trên `main` | full compile + integration + semantic parity + E2E |

---

# PART 12 — Docker Architecture, Shared Volume, Path Security

## 12.1 Docker Compose khung sườn (tối thiểu, dev/single-user)

```yaml
services:
  sim-frontend:
    build: ./sim-frontend
    ports: ["3000:3000"]
    depends_on: [codegen-service]

  codegen-service:
    build: ./codegen-service
    volumes:
      - shared-workspace:/workspace
    depends_on: [vehicle-model-catalog, workspace-service]

  vehicle-model-catalog:
    build: ./vehicle-model-catalog

  workspace-service:
    build: ./workspace-service
    volumes:
      - shared-workspace:/workspace

  code-server:
    image: codercom/code-server:latest
    volumes:
      - shared-workspace:/workspace
    ports: ["8080:8080"]
    command: ["--auth", "password", "/workspace"]

volumes:
  shared-workspace:
```

## 12.2 Path Security (bắt buộc, không được bỏ)
- Workspace Service phải validate mọi path ghi ra nằm trong root workspace đã cấu hình (chống path traversal `../../`).
- Chỉ ghi vào `app/src/generated/**` và merge có kiểm soát vào `app/AppManifest.json` — không bao giờ ghi ra ngoài project root, không bao giờ ghi đè `.velocitas.json`.
- Container `codegen-service` chạy với user non-root, filesystem mount read-write chỉ đúng `shared-workspace`.

## 12.3 Multi-user (P2/P3)
- Mỗi user/session có workspace riêng (subvolume hoặc namespace theo `userId/projectId`), tránh 2 người dùng ghi đè lẫn nhau. Container lifecycle: dev đơn giản (1 container set/user chạy sẵn) vs production (spawn on-demand + idle timeout, xem mục "Container Lifecycle Options" bản gốc).

---

# PART 13 — Security, Observability, Performance, Error Policy

## 13.1 Security
- Không expose Codegen Service hay Workspace Service trực tiếp ra internet không auth.
- Validate toàn bộ input workflow JSON trước khi vào compiler (chống payload cực lớn / recursive structure gây DoS bộ compiler — tham chiếu bài học "Request body size limit" thấy trong chính source `sim` thật, §0.1).
- AppManifest merge không được cho phép user tự nhét path VSS tuỳ ý không qua Catalog validate (chống injection interface giả).

## 13.2 Observability
- `generationId` xuyên suốt log (từ compiler → backend → verification → workspace write) để trace 1 lần SynCode từ đầu tới cuối.
- Metrics tối thiểu: thời gian mỗi stage pipeline, tỉ lệ SynCode fail theo mã lỗi, thời gian build thật.

## 13.3 Performance
- Vehicle Model Catalog phải cache parse result (VSS file lớn, hàng nghìn path) — không parse lại mỗi request.
- Compile verification (build C++ thật) là bước tốn thời gian nhất — cân nhắc incremental build (CMake/Conan cache) thay vì clean build mỗi lần SynCode.

## 13.4 Error Policy
- Mọi lỗi trả về đều theo Diagnostics format (Part 7.2) — không trả raw stack trace C++ compiler thẳng cho UI; Builder/Verification Service phải parse compiler output thành diagnostic có `blockId` traceable nếu có thể (qua source map, xem Part IR Traceability), fallback về lỗi chung "compile failed, xem log chi tiết" nếu không map được.

---

# PART 14 — Recommended MVP Cut & Milestones

## 14.1 MVP Cut (nếu cần release sớm, không chờ đủ 30 phase)
Bắt buộc có: Phase 0–21 (tới khi SynCode + code-server hoạt động end-to-end cho C++, service để sau).
Có thể hoãn: Phase 22 (full feature coverage) một phần, Phase 23–25 (curated block, service modes) → làm tối thiểu 1 ví dụ mỗi loại thay vì đầy đủ, Phase 29–30 (Python/Rust) hoãn hoàn toàn.

## 14.2 Milestones

| Milestone | Nội dung | Tương ứng Phase |
|---|---|---|
| A — Canvas becomes Vehicle Studio | Toolbar dynamic từ VSS, block vehicle cơ bản | 0–9 |
| B — Compiler frontend | Graph → IR, validation, diagnostics | 10–13 |
| C — Deterministic C++ | Runtime + Backend MVP | 14–15 |
| D — SynCode + IDE | Full pipeline + code-server | 16–21 |
| E — Services | Inline + standalone | 22–25 |
| F — Multi-language | Python/Rust feasibility | 26–30 |

## 14.3 Implementation Priority Matrix (giữ nguyên từ bản gốc, đã đối chiếu đúng phase)

- **P0:** Baseline, Sim canvas, Vehicle Model, Dynamic blocks, IR, Validator, Simulator, C++ backend, Runtime, SynCode, Workspace, Build verification, code-server.
- **P1:** AppManifest generation, Virtual clock, Source maps, Model compatibility, Concurrency policies, Golden tests, E2E.
- **P2:** Parallel/Join, curated multi-VSS blocks, inline services.
- **P3:** Standalone apps, Python, Rust, advanced control flow.

---

# PART 15 — AI Coding Agent Operating Instructions

1. Không được viết code cho phase N+1 trước khi Phase N đạt Acceptance Gate PASS.
2. Mọi thay đổi kiến trúc lệch khỏi tài liệu này phải ghi thành ADR (Part 15.1) — không âm thầm đổi.
3. Không dùng LLM sinh production C++ (Part 3.3) — vi phạm là lỗi nghiêm trọng, phải revert.
4. Mỗi block mới phải qua đủ checklist Definition of Done (Part 5.6).
5. Mỗi phase kết thúc, viết report theo Appendix D, gắn `Acceptance gate: PASS/FAIL` rõ ràng.
6. Khi phát hiện sai khác giữa tài liệu và source code thật của `sim`/`vehicle-app-cpp-template` (rất có thể xảy ra vì các repo này đang phát triển nhanh, xem §0.1), agent phải: (a) ưu tiên source code thật, (b) ghi ADR nêu rõ sai khác và quyết định xử lý, (c) không tự ý mở rộng scope ngoài tài liệu mà không ghi chú.
7. Không mass-delete code cũ của Sim trước Phase 28.
8. Toàn bộ path ghi ra Velocitas workspace phải qua Workspace Service, không service nào khác được ghi trực tiếp filesystem.

## 15.1 Required Architecture Decision Records (ADR) — bắt buộc viết cho các quyết định sau
- ADR-001: Cách tái sử dụng cơ chế `custom-blocks` có sẵn trong Sim vs sửa `registry.ts` core (Phase 3).
- ADR-002: Chiến lược đồng bộ/không đồng bộ với upstream `simstudioai/sim` sau khi fork.
- ADR-003: Cơ chế source map giữa IR node và generated C++ (cho compiler error → block diagnostic).
- ADR-004: Chọn thư viện expression parser cho Part 6.6.
- ADR-005: Chiến lược versioning cho `libvehicle-studio-runtime` (Conan package riêng hay vendor trong template).

## 15.2 Documentation Required (deliverable bắt buộc, không phải optional)
- `docs/BASELINE.md`
- `docs/BLOCK_SDK.md`
- `docs/ADD_NEW_BLOCK.md` (workflow thêm block mới, ví dụ từng bước cụ thể)
- `docs/IR_SPEC.md` (đồng bộ với Part 6, có JSON Schema file thật kèm theo, không chỉ mô tả)
- `docs/DIAGNOSTICS_CATALOG.md`
- `docs/RUNTIME_API.md`
- `docs/ADRs/*.md`

---

# PART 16 — Risk Register (giữ nguyên 8 risk gốc, thêm mitigation cụ thể)

| Risk | Mô tả | Mitigation |
|---|---|---|
| R1 — Coupling to Sim internal executor | Executor DAG của Sim có thể không khớp semantics workflow automotive | Dùng executor Sim chỉ cho Run/Debug UI-level; Simulator thật (Part 7.4) chạy trên IR độc lập, không phụ thuộc executor engine của Sim |
| R2 — VSS/model changes | VSS đổi giữa lúc thiết kế và lúc build | `modelHash` trong IR + diagnostic `MODEL_HASH_MISMATCH` (Part 7.2) |
| R3 — Generated C++ SDK API mismatch | SDK thật đổi API | Runtime Library cô lập adapter (Part 8.2), chỉ 1 nơi cần sửa khi SDK đổi |
| R4 — Callback/timer race | Concurrency bug trong generated app | Toàn bộ timer/subscription nằm trong Runtime Library đã test kỹ, không sinh lại logic này mỗi lần (Part 3.4, 8.7) |
| R5 — code-server proxy issues | Proxy path/auth phức tạp | Dùng cấu hình chính thức `codercom/code-server` (Part 12.1), test riêng ở Phase 21 |
| R6 — Services explode complexity | Quá nhiều service mode/kết hợp | Giới hạn 2 mode rõ ràng (Part 8.6), P2 mới mở rộng |
| R7 — Multi-language divergence | Python/Rust backend không đồng bộ semantics với C++ | Semantic Parity Test (Phase 27) áp dụng cho mọi backend, không riêng C++ |
| R8 — Sim cleanup breaks database/workflows | Xoá sớm phá dữ liệu cũ | Không mass-delete trước Phase 28 (Part 9 Phase 2 note) |
| R9 (mới) — Upstream `sim` drift nhanh | Repo `sim` cập nhật liên tục, có breaking refactor (đã thấy thực tế ở registry.ts) | Pin cứng tag, không auto-sync, review thủ công theo ADR-002 |
| R10 (mới) — AppManifest schema đổi version | Velocitas có thể phát hành `manifestVersion` mới sau v3 | Manifest Analyzer (Phase 16) viết theo interface versioned, dễ thêm handler cho version mới mà không phải viết lại toàn bộ |

---

# PART 17 — Automotive Safety Boundary (giữ nguyên, làm rõ)

Hệ thống này sinh code cho **workflow logic ứng dụng cấp cao** (App layer trên Vehicle Abstraction/KUKSA), KHÔNG can thiệp vào:
- Safety-critical control loop thời gian thực (ECU firmware, brake-by-wire logic thật).
- Bất kỳ actuator nào ngoài phạm vi các datapoint được khai báo an toàn qua Databroker/AppManifest.

No-Code Studio phải hiển thị rõ ràng (UI banner/tooltip) rằng: workflow sinh ra là ứng dụng cấp cao chạy trên KUKSA Vehicle Abstraction Layer, không thay thế hệ thống an toàn xe (ASIL-rated). Đây là ranh giới trách nhiệm cần ghi rõ trong tài liệu người dùng cuối, không chỉ trong tài liệu kỹ thuật.

---

# PART 18 — Đề xuất cải tiến bổ sung (ngoài bản gốc, do phân tích thêm)

Các phần dưới đây **KHÔNG có trong bản gốc**, được đề xuất thêm để cải thiện hệ thống — tuỳ đội ngũ quyết định đưa vào scope P1/P2:

1. **Workflow linting cấp UX (trước khi SynCode):** hiển thị cảnh báo ngay trên canvas (không cần bấm SynCode) khi có `TRIGGER_WITHOUT_ACTION` hay property thiếu, giảm vòng lặp sửa-lỗi.
2. **Dry-run compile (IR-only) như một action riêng** tách khỏi SynCode đầy đủ (không build C++ thật, chỉ tới bước 6 pipeline) — giúp UX nhanh hơn khi user chỉ muốn biết workflow có hợp lệ không.
3. **Snapshot/rollback UI:** vì Generation Manifest (Part 8.4) đã lưu checksum từng lần generate, nên expose UI cho phép user rollback về lần SynCode trước đó (đặc biệt hữu ích khi build fail sau khi đã sửa nhiều lần).
4. **Block usage analytics nội bộ (opt-in, không phải AI/marketplace):** biết block nào được dùng nhiều để ưu tiên curate multi-VSS block (Phase 23) đúng nhu cầu thật thay vì đoán.
5. **Explicit "VSS release pinning" UI:** cho phép user chọn version VSS release cụ thể (vd v3.0 vs v4.x) ngay trong Project Configuration, tránh việc đổi VSS ngầm gây `MODEL_HASH_MISMATCH` bất ngờ.
6. **Conformance test cho Runtime Library độc lập với Codegen:** vì Runtime Library là thư viện versioned riêng (Part 15.1 ADR-005), nên có bộ test conformance riêng chạy trong CI của chính nó, tách khỏi CI của Codegen Service — cho phép release Runtime Library nhanh hơn khi chỉ sửa bug runtime (đúng tinh thần nguyên tắc 3.4 "sửa bug runtime một lần cho mọi workflow").
7. **Formal source map giữa IR node ↔ dòng code C++ sinh ra** (không chỉ `sourceBlockId` ở mức node): giúp Builder/Verification Service (Phase 18) map lỗi compiler thật về đúng block trên canvas chính xác tới dòng, không chỉ tới node.

---

# APPENDIX A — Example SynCode Response (thành công)

```json
{
  "success": true,
  "generationId": "gen-...",
  "workflowRevision": 31,
  "modelHash": "...",
  "compilerVersion": "1.0.0",

  "verification": {
    "ir": "passed",
    "format": "passed",
    "compile": "passed",
    "tests": "passed"
  },

  "generatedFiles": [
    "app/src/generated/workflows/speed_guard.hpp",
    "app/src/generated/workflows/speed_guard.cpp"
  ],

  "editor": {
    "url": "https://ide.example.com/?folder=/workspaces/project"
  }
}
```

# APPENDIX B — Example Failure

```json
{
  "success": false,
  "stage": "vehicle-model-validation",
  "diagnostics": [
    {
      "code": "VEHICLE_WRITE_READ_ONLY",
      "severity": "error",
      "blockId": "block-set-speed",
      "message": "Vehicle.Speed is a sensor and cannot be written.",
      "suggestion": "Choose a VSS actuator path."
    }
  ]
}
```

# APPENDIX C — Example Block Package

```text
vehicle-blocks/
└── stable-for/
    ├── definition.ts
    ├── semantics.md
    ├── migration.ts
    ├── simulator.ts
    └── stable-for.test.ts
```

```ts
export const StableForBlock = {
  schemaVersion: 1,
  type: 'control.stable_for',
  version: 1,
  name: 'Stable For',
  category: 'flow',
  inputs: {
    value: { type: 'generic' }
  },
  outputs: {
    value: { type: 'same-as-input:value' }
  },
  properties: [
    { id: 'duration', type: 'duration', required: true }
  ],
  compiler: {
    opcode: 'control.stable_for'
  }
};
```

# APPENDIX D — AI Agent Phase Completion Report Template

```text
Phase:
Objective:

Changed modules:

New public contracts:

Migrations:

Tests added:

Commands executed:

Results:

Known unsupported cases:

Regression checks:

Acceptance gate:
PASS / FAIL

Follow-up:
```
Không được chuyển sang phase phụ thuộc khi gate là FAIL.

---

# APPENDIX E — Nguồn tham khảo đã verify (kèm ghi chú, ngày tra cứu 2026-08-11)

- SimStudioAI repo (mô tả hiện tại, cấu trúc block/tools/registry): `https://github.com/simstudioai/sim`
- Sim CONTRIBUTING guide (quy trình thêm block): `https://github.com/simstudioai/sim/blob/main/.github/CONTRIBUTING.md`
- Sim block registry: `https://github.com/simstudioai/sim/blob/main/apps/sim/blocks/registry.ts` (lưu ý: pin theo tag `v0.7.13` khi implement, không dùng `main`)
- Sim custom-blocks API route: `https://github.com/simstudioai/sim/blob/main/apps/sim/app/api/custom-blocks/route.ts`
- Eclipse Velocitas C++ template: `https://github.com/eclipse-velocitas/vehicle-app-cpp-template`
- Eclipse Velocitas C++ SDK (ví dụ thật): `https://github.com/eclipse-velocitas/vehicle-app-cpp-sdk`
- Velocitas Vehicle App Manifest (schema v3, ví dụ thật): `https://eclipse.dev/velocitas/docs/concepts/development_model/vehicle_app_manifest/`
- Velocitas Project Configuration (`.velocitas.json`): `https://eclipse.dev/velocitas/docs/concepts/lifecycle_management/project_configuration/`
- Velocitas CLI: `https://eclipse.dev/velocitas/docs/concepts/lifecycle_management/velocitas_cli/`
- COVESA VSS Overview: `https://covesa.github.io/vehicle_signal_specification/introduction/overview/`
- COVESA VSS Sensor/Actuator rule set: `https://covesa.github.io/vehicle_signal_specification/rule_set/data_entry/sensor_actuator/`
- COVESA VSS Data types: `https://covesa.github.io/vehicle_signal_specification/rule_set/data_entry/data_types/`
- COVESA VSS Units: `https://covesa.github.io/vehicle_signal_specification/rule_set/data_entry/data_units/`
- code-server guide: `https://coder.com/docs/code-server/guide`

**Lưu ý cho agent:** repo `simstudioai/sim` phát triển rất nhanh (đã có release sau `v0.7.13`, ví dụ log cho thấy `v0.7.26+`). Trước khi bắt đầu Phase 0, agent phải tự re-verify các đường link/API trên còn đúng tại thời điểm thực thi, vì các dữ kiện này có thể đã thay đổi so với ngày biên soạn tài liệu (2026-08-11).

---

**Hết tài liệu — Master Plan v2.**

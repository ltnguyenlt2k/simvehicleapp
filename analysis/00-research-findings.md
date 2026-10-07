# 00 — Research Findings (đã verify ngày 2026-09-30)

> Tài liệu nền. Mọi quyết định trong [ADR](adr/README.md) và [roadmap](13-implementation-roadmap.md) dựa trên các dữ kiện dưới đây.
> Tất cả dữ kiện được lấy trực tiếp từ GitHub API / raw source tại ngày 2026-09-30. Khi implement, agent **phải xác minh đúng pin** (skill `.claude/skills/upstream-verify`): source local có provenance đúng SHA/digest là bằng chứng hợp lệ; thiếu bằng chứng, thay pin hoặc thông tin động thì kiểm nguồn chính thức online. Không tải lại cùng source bất biến mỗi task.
> Liên quan: [01-requirements](01-requirements.md) · [03-system-architecture](03-system-architecture.md) · [04-velocitas-deep-dive](04-velocitas-deep-dive.md)

---

## 1. Bảng pin phiên bản (Baseline Lock)

| Thành phần | Phiên bản pin | Commit / Image | License | Ghi chú |
|---|---|---|---|---|
| `simstudioai/sim` | tag `v0.7.13` | `ad0b8678b5dc4b6d5703481d567f29c9facc6f67` (commit 2026-06-24) | Apache-2.0 (**trừ `apps/sim/ee/`**) | Upstream đã lên `v0.9.6` (2026-09-29) |
| `eclipse-velocitas/vehicle-app-cpp-template` | `main` | `275e858e3de8f43d6b4c71a389e358dffe73b42b` (2026-01-05) | Apache-2.0 | CLI `v0.13.2`, Conan 2 |
| `eclipse-velocitas/vehicle-app-python-template` | `main` | `e7082f75d1831489462f6672b6858f7ea7708256` | Apache-2.0 | `velocitas-sdk==0.15.7` |
| `eclipse-velocitas/vehicle-app-cpp-sdk` | `v0.7.1` | `6323b657a99749fd9a6770b9b35a6e8c801a60bc` (2025-12-15) | Apache-2.0 | template dùng `vehicle-app-sdk/0.7.1` |
| Velocitas devcontainer base image | `ghcr.io/eclipse-velocitas/devcontainer-base-images/cpp:v0.4` | — | Apache-2.0 | dùng làm base cho toolchain image |
| Velocitas packages | `devenv-runtimes v4.1.0`, `devenv-devcontainer-setup v3.0.0`, `devenv-github-workflows v7.0.0`, `devenv-github-templates v1.0.5` | từ `.velocitas.json` template | Apache-2.0 | |
| KUKSA Databroker | **`ghcr.io/eclipse-kuksa/kuksa-databroker:0.5.0`** | (mới nhất 0.7.1, 2026-08-26) | Apache-2.0 | 0.5.0 là bản Velocitas `runtime-local` đang test chung với SDK |
| KUKSA Databroker CLI | `ghcr.io/eclipse-kuksa/kuksa-databroker-cli:0.5.0` | | Apache-2.0 | |
| KUKSA Mock Provider | `ghcr.io/eclipse-kuksa/kuksa-mock-provider/mock-provider:0.4.1` | | Apache-2.0 | |
| Mosquitto | `eclipse-mosquitto:2.0.14` | | EPL-2.0/EDL-1.0 | dùng image nguyên bản, không sửa |
| VSS | **v4.0** (`vss_rel_4.0.json`) mặc định | (mới nhất v6.1, 2026-09-17) | MPL-2.0 (spec) | template AppManifest trỏ tới v4.0; model generator hỗ trợ 3.x, 4.x |
| `vss-tools` | v4.1.1 | | MPL-2.0 | chỉ dùng như tool ngoài, không vendor code |
| `kuksa-rust-sdk` | 0.2.2 | | Apache-2.0 | hỗ trợ `kuksa.val.v2`, `kuksa.val.v1`, `sdv.databroker.v1` |
| `vehicle-app-rust-sdk` (Velocitas) | — | | Apache-2.0 | **repo gần như rỗng** (README 1 dòng) → không dùng |
| code-server | `v4.139.1` | | MIT | extension lấy từ Open VSX |
| MCP spec | `2026-07-28` (có `2025-11-25`, `2025-06-18`…) | | MIT | TS SDK `v1.31.0` (2026-09-28; **re-verify tại M10**, release rất nhanh — xem [ADR-0030 Notes](adr/ADR-0030-ai-assistant-mcp.md)) |
| Blockly | v13.3.0 | | Apache-2.0 | chỉ tham khảo khái niệm, không dùng canvas |
| Scratch (`scratch-vm`, `scratch-editor`) | — | | **AGPL-3.0 từ 2024-11-25** | **CẤM copy code**, chỉ tham khảo khái niệm (clean-room) |
| Conan | 2.x (mới nhất 2.33.0) | | MIT | dùng version do Velocitas base image cài |

---

## 2. SimStudioAI (`simstudioai/sim` @ v0.7.13) — cấu trúc thật

### 2.1 Stack
Next.js (App Router) + **Bun**, PostgreSQL (image `pgvector/pgvector:pg17`) + **Drizzle ORM**, **ReactFlow** canvas, **Zustand** + TanStack Query, Shadcn/Tailwind, **Better Auth**, **Socket.io** realtime (app riêng `apps/realtime`), Trigger.dev (background jobs), Turborepo monorepo.

### 2.2 Layout (v0.7.13)
```
apps/            docs, pii (Presidio sidecar), realtime, sim
packages/        audit, auth, cli, db, logger, platform-authz, python-sdk,
                 realtime-protocol, security, testing, ts-sdk, tsconfig,
                 utils, workflow-persistence, workflow-types
apps/sim/        app/ background/ blocks/ components/ connectors/ content/
                 ee/ emails/ enrichments/ executor/ hooks/ lib/ providers/
                 public/ sandbox-tasks/ scripts/ serializer/ stores/ tools/ triggers/
docker/          app.Dockerfile, db.Dockerfile, pii.Dockerfile, realtime.Dockerfile
docker-compose.{local,ollama,prod}.yml, .devcontainer/, helm/
```
- `apps/sim/blocks/`: `registry.ts`, `index.ts`, `types.ts`, `utils.ts`, `blocks/` (**273 block files** tại v0.7.13).
- `apps/sim/stores/workflows/`: `workflow/store.ts`, `edge-validation.ts`, `validation.ts`, `registry/`, `subblock/`.
- `apps/sim/executor/`: `dag/`, `execution/`, `handlers/`, `orchestrators/`, `variables/`, `human-in-the-loop/`.
- `apps/sim/serializer/`, `apps/sim/providers/` (anthropic, openai, gemini, ollama, vllm, litellm, bedrock, azure-*, … 30+ provider).
- `apps/sim/app/api/mcp` (đã có MCP support), `apps/sim/lib/copilot/**` (~420 file liên quan copilot).

### 2.3 Mô hình dữ liệu workflow (quan trọng cho compiler)
Từ `packages/workflow-types/src/workflow.ts`:
- `BlockState { id, type, name, position, subBlocks: Record<string, SubBlockState>, outputs, enabled, data?: { parentId, extent, loopType, parallelType, ... } }`
- `SubBlockState { id, type: SubBlockType, value }`
- Edge là **ReactFlow Edge** (`source`, `target`, `sourceHandle`, `targetHandle`) → **chỉ là control-flow**.
- **Dữ liệu truyền qua tham chiếu** dạng `<blockName.field>` trong giá trị subBlock (ví dụ block Condition viết biểu thức JavaScript tham chiếu `<block.output>`).
- Subflow container: `loop` (`for|forEach|while|doWhile`) và `parallel` (`count|collection`) — node con có `data.parentId`.

`BlockConfig` (`apps/sim/blocks/types.ts`): `type, name, description, category: 'blocks'|'tools'|'triggers', bgColor, icon, subBlocks: SubBlockConfig[], tools: {access, config}, inputs, outputs, hideFromToolbar?, triggers?`.

### 2.4 Phát hiện quan trọng — lệch so với Master Plan v2

| # | Master Plan v2 nói | Thực tế | Hệ quả |
|---|---|---|---|
| F1 | Dùng `apps/sim/app/api/custom-blocks/route.ts` để đăng ký block (ADR-001) | **Không tồn tại ở v0.7.13**. Ở v0.9.6 có, nhưng là **tính năng Enterprise** (`apps/sim/ee/custom-blocks`, docs `platform/enterprise/custom-blocks`) | Không được dựa vào custom-blocks. Xem [ADR-0011](adr/ADR-0011-block-model-on-canvas.md) |
| F2 | Repo toàn bộ Apache-2.0 | `apps/sim/ee/LICENSE` là **Sim Enterprise License**: chỉ cho dev/test, *production cần subscription, cấm modify/redistribute* | Phải **xoá toàn bộ `apps/sim/ee/`** và mọi import tới nó ngay M1 (ngoại lệ với luật "không mass-delete trước Phase 28"). Xem [ADR-0004](adr/ADR-0004-license-compliance.md) |
| F3 | Copilot/AI chỉ là "AI-specific surface" | Copilot gọi backend độc quyền `https://www.copilot.sim.ai` (`SIM_AGENT_API_URL`, `COPILOT_API_KEY`) | Thay hoàn toàn bằng `simvehicleapp-ai` (chat + MCP). Xem [ADR-0030](adr/ADR-0030-ai-assistant-mcp.md) |
| F4 | Condition dùng biểu thức tuỳ ý | Sim viết condition bằng **JavaScript** thực thi trong `isolated-vm` | Vehicle workflow dùng **expression language riêng** (không eval JS). Xem [ADR-0013](adr/ADR-0013-dataflow-and-expression-language.md) |
| F5 | Pin v0.7.13 | Upstream đã v0.9.6 với refactor lớn (desktop app, mothership, emcn) | Giữ pin v0.7.13 (đã có đủ canvas/executor/providers/mcp). Xem [ADR-0003](adr/ADR-0003-upstream-baseline-and-fork-policy.md) |
| F6 | — | Có `DISABLE_AUTH=true` cho self-host mạng private | Dùng cho chế độ single-user dev |

---

## 3. Eclipse Velocitas — cấu trúc thật

### 3.1 `vehicle-app-cpp-template` (@275e858)
```
.velocitas.json          packages + components + variables (appManifestPath=app/AppManifest.json)
.velocitas-lock.json
conanfile.txt            fmt/11.1.1, nlohmann_json/3.11.3, vehicle-model/generated, vehicle-app-sdk/0.7.1
CMakeLists.txt           C++17, find_package(vehicle-app-sdk, vehicle-model, fmt, nlohmann_json), add_subdirectory(app)
build.sh                 = velocitas exec build-system build $@
install_dependencies.sh  = velocitas exec build-system install $@
requirements.txt         (python tooling cho velocitas/conan)
app/AppManifest.json     manifestVersion v3, VSS v4.0 src, Vehicle.Speed read, pubsub topics
app/CMakeLists.txt       include(service-libs.cmake OPTIONAL); add_subdirectory(src, tests)
app/Dockerfile           build headless (xem 3.3)
app/src/                 CMakeLists.txt (target "app"), Launcher.cpp, SampleApp.h/.cpp
app/tests/utests/        gtest, SampleApp_test.cpp
.devcontainer/           Dockerfile FROM devcontainer-base-images/cpp:v0.4 + scripts onCreate (velocitas init; velocitas sync; setup-dependencies)
.vscode/tasks.json       "Local Runtime - Up/Down/Run VehicleApp", "(Re-)generate vehicle model", ...
```
**Lệch với master plan:**
- Không còn biến `generatedModelPath` trong template C++ (vehicle model là Conan package `vehicle-model/generated` sinh bởi component `vehicle-signal-interface`). Template **Python** vẫn có `generatedModelPath: ./gen/vehicle_model`.
- Package versions: `devenv-runtimes v4.1.0`, `devenv-devcontainer-setup v3.0.0` (master plan ghi v3.1.0/v2.1.0 — cũ).
- VSS mặc định trong AppManifest: **v4.0** (không phải 3.0).
- Trong AppManifest thực tế, datapoint dùng key `"required": "true"` (không phải `"optional"`).

### 3.2 Các lệnh CLI thật (từ `.vscode/tasks.json` & `devenv-runtimes/manifest.json`)
| Mục đích | Lệnh |
|---|---|
| Khởi tạo package | `velocitas init` (`-f -v` để force/verbose) · `velocitas sync` |
| Cài dependency (Conan) | `./install_dependencies.sh` (= `velocitas exec build-system install`), `-r` = release |
| Build | `./build.sh` (= `velocitas exec build-system build`), `-r` release, `-t app` target, `--static` |
| Sinh vehicle model | `velocitas exec vehicle-signal-interface download-vspec && velocitas exec vehicle-signal-interface generate-model` |
| Sinh gRPC SDK | `velocitas exec grpc-interface-support generate-sdk` |
| Runtime local | `velocitas exec runtime-local up|down|run-vehicle-app <exe>|run-vehicledatabroker-cli` |

### 3.3 Build headless không cần devcontainer — bằng chứng từ `app/Dockerfile`
```dockerfile
FROM ghcr.io/eclipse-velocitas/devcontainer-base-images/cpp:v0.4 AS builder
COPY . /workspace
WORKDIR /workspace
RUN pip install -r requirements.txt && \
    velocitas init -f -v && \
    ./install_dependencies.sh -r && \
    ./build.sh -r -t app --static
FROM scratch AS runner
COPY --from=builder /workspace/build/bin/app /app
CMD ["/app"]
```
→ Toolchain container của SimVehicleApp **tái sử dụng đúng chuỗi lệnh này** (xem [ADR-0025](adr/ADR-0025-headless-velocitas-toolchain.md)).

### 3.4 `runtime-local` thực chất làm gì
`devenv-runtimes/runtime_local/src/local_lib.py` gọi `docker run --rm --init --network host <image>` cho từng service trong `runtime.json`:
- `mqtt-broker`: `eclipse-mosquitto:2.0.14`, port 1883 + 9001, `mosquitto -c /mosquitto-no-auth.conf`
- `vehicledatabroker`: `kuksa-databroker:0.5.0`, port 55555, env `KUKSA_DATABROKER_METADATA_FILE=<vspec json>`, arg **`--enable-databroker-v1`**
- `seatservice`, `feedercan`, `mockservice` (tắt mặc định)

`run-vehicle-app.py` chạy app với env:
```
SDV_MIDDLEWARE_TYPE=native
SDV_VEHICLEDATABROKER_ADDRESS=grpc://127.0.0.1:55555
SDV_MQTT_ADDRESS=mqtt://127.0.0.1:1883
```
→ runtime-local **cần Docker socket + network host**. SimVehicleApp thay bằng **các service compose ngang hàng** (databroker, mqtt, mock-provider) và set env trỏ tới hostname compose (xem [ADR-0024](adr/ADR-0024-databroker-api-and-runtime-stack.md)).

### 3.5 C++ SDK v0.7.1 — API thật
- `velocitas::VehicleApp(std::shared_ptr<IVehicleDataBrokerClient>, std::shared_ptr<IPubSubClient> = {})`; `run()`, `stop()`, `virtual onStart()`, `onStop()`.
- Protected: `subscribeToTopic(topic) -> AsyncSubscriptionPtr_t<std::string>`, `publishToTopic(topic, data)`, `getDataPoints(vector<ref<DataPoint>>)`, `getDataPoint(dp)`, `subscribeDataPoints(queryString)`.
- `TypedDataPoint<T>::get() -> AsyncResultPtr_t<TypedDataPointValue<T>>`, `set(T) -> AsyncResultPtr_t<Status>`; alias `DataPointFloat`, `DataPointBoolean`, `DataPointInt32`, `DataPointUint8Array`…
- Batch: `Vehicle.setMany().add(dp, v).add(...).apply()->await()`.
- Subscribe: `subscribeDataPoints(QueryBuilder::select(Vehicle.Speed).build())->onItem(cb)->onError(cb)`; value: `reply.get(Vehicle.Speed)->value()`.
- Sync get: `Vehicle.Speed.get()->await().value()`.
- Scheduling: `velocitas::ThreadPool`, `Job::create(fn, delay)`, `RecurringJob` (cancel).
- Env: `SDV_MIDDLEWARE_TYPE`, `SDV_VEHICLEDATABROKER_ADDRESS`, `SDV_MQTT_ADDRESS`, `SDV_SUBSCRIBE_BUFFER_SIZE`, `SDV_VDB_CHANNEL_CONFIG_PATH`, và **`KUKSA_DATABROKER_API`** ∈ {`sdv.databroker.v1` (mặc định), `kuksa.val.v2`}.
- Với `kuksa.val.v2`, `set()` = `BatchActuate` → **bắt buộc có provider** cho actuator, nếu không trả `UNAVAILABLE`.

### 3.6 Python SDK 0.15.7
- `VehicleApp.on_start()` async; `await self.Vehicle.Speed.subscribe(cb)`; `(await self.Vehicle.Speed.get()).value`; `await dp.set(v)`; `@subscribe_topic(topic)`; `await self.publish_event(topic, json)`.
- Chỉ dùng proto `sdv.databroker.v1` (`broker_pb2`, `collector_pb2`).
→ **Mẫu số chung** cho C++ + Python = databroker bật `--enable-databroker-v1`.

### 3.7 Rust
- `eclipse-velocitas/vehicle-app-rust-sdk`: gần như rỗng → **không có Velocitas Rust SDK / template**.
- `eclipse-kuksa/kuksa-rust-sdk 0.2.2`: client cho `kuksa.val.v2/v1`, `sdv.databroker.v1`.
→ Rust backend phải tự cung cấp "velocitas-like template" + runtime (xem [ADR-0041](adr/ADR-0041-rust-backend-feasibility.md)).

### 3.8 KUKSA Databroker — protocol
| Protocol | Current value Set/Get/Sub | Target value | Actuation |
|---|---|---|---|
| `kuksa.val.v2` (khuyến nghị, duy nhất còn phát triển) | ✔ ✔ ✔ | ✘ | Set ✔ / Sub ✔ |
| `kuksa.val.v1` (deprecated) | ✔ ✔ ✔ | ✔ ✔ ✔ | ✘ |
| `sdv.databroker.v1` (deprecated, phải bật `--enable-databroker-v1`) | ✔ ✔ ✔ | Set ✔ | ✘ |

Cờ: `--vss <file>` / `KUKSA_DATABROKER_METADATA_FILE`, `--insecure`, `--disable-authorization`, `--port` (55555), `--enable-viss`.
**Không trộn** provider/consumer khác protocol cho cùng actuator (Target vs Actuation là 2 kênh khác nhau).

**Cập nhật 2026-10-07 (kiểm online, [spike kuksa-val-v2](../docs/spikes/kuksa-val-v2/README.md)):** databroker mới nhất 0.7.1; **0.7.0 xoá `sdv.databroker.v1`** (chỉ còn `kuksa.val.v1` + `kuksa.val.v2`); 0.6.1 sửa lỗi bảo mật `OpenProviderStream` (cần JWT để khai thác). Pin 0.5.0 giữ nguyên — lộ trình ở [ADR-0047](adr/ADR-0047-kuksa-val-v2-migration.md). `kuksa-client` 0.6.0 có stub v2; Velocitas Python SDK mới nhất vẫn v0.15.7 (chỉ v1).

### 3.9 VSS 4.0 JSON (đã tải và phân tích)
- Cấu trúc: `{"Vehicle": {"type":"branch","children":{...}}}`; leaf có `datatype`, `type` (`sensor|actuator|attribute`), `unit`, `min`, `max`, `allowed`, `description`, `uuid`, `deprecation`.
- Thống kê v4.0: **branch 287, actuator 425, sensor 379, attribute 106**.
- Datatypes xuất hiện: `boolean, double, float, int8, int16, int32, string, string[], uint8, uint16, uint32, uint8[]`.
- Ví dụ: `Vehicle.Speed` (float, sensor, km/h); `Vehicle.Powertrain.TractionBattery.StateOfCharge.Current` (float, sensor, percent, 0..100).
- Instance đã được expand trong JSON release (`Vehicle.Cabin.Seat.Row1.DriverSide.Position`), khớp tên member của C++ model được sinh.

---

## 4. Scratch — chỉ tham khảo khái niệm (clean-room)
- `scratch-vm`, `scratch-gui` (nay là `scratch-editor`) chuyển sang **AGPL-3.0 ngày 2024-11-25**. Bản cũ BSD vẫn fork được, nhưng để tránh rủi ro: **không đọc-rồi-chép code**, không dùng tên opcode/định nghĩa block của Scratch.
- Khái niệm được phép tham khảo (ý tưởng, không bảo hộ bản quyền): *hat block* (trigger), *stack* (chuỗi lệnh), *reporter* (biểu thức trả giá trị), *thread per trigger firing*, *yield tại các block chờ*, *edge-triggered hat* ("khi điều kiện trở thành đúng"), *stop this script / stop all*.
- Quy tắc clean-room: xem [ADR-0012](adr/ADR-0012-execution-semantics.md) §Clean-room.

---

## 5. MCP & LLM
- MCP spec mới nhất: `2026-07-28`; TS SDK `@modelcontextprotocol/sdk` **v1.31.0** (đã sửa từ "v2.2.0" ghi sai trước đó — package chưa từng phát hành major version 2, xác nhận qua `npm view … versions` ngày 2026-10-01); transport khuyến nghị: Streamable HTTP.
- Sim v0.7.13 đã có `apps/sim/providers/*` (anthropic, openai, gemini, ollama, vllm, litellm, …) — **Apache-2.0**, có thể tái sử dụng cho `simvehicleapp-ai`.

## 6. code-server
- `coder/code-server` v4.139.1, MIT. Marketplace mặc định là **Open VSX**.
- **Không** được dùng `ms-vscode.cpptools` / Pylance ngoài VS Code chính thức (điều khoản license Microsoft) → dùng `llvm-vs-code-extensions.vscode-clangd`, `ms-vscode.cmake-tools` (MIT), `ms-python.python` (Open VSX), `detachhead.basedpyright`.

---

## 7. Nguồn
- https://github.com/simstudioai/sim (tag v0.7.13, v0.9.6; `apps/sim/ee/LICENSE`)
- https://github.com/eclipse-velocitas/vehicle-app-cpp-template · https://github.com/eclipse-velocitas/vehicle-app-python-template
- https://github.com/eclipse-velocitas/vehicle-app-cpp-sdk · https://github.com/eclipse-velocitas/vehicle-app-python-sdk
- https://github.com/eclipse-velocitas/devenv-runtimes (`runtime.json`, `manifest.json`, `runtime_local/src/*`)
- https://github.com/eclipse-velocitas/vehicle-model-generator · https://github.com/eclipse-velocitas/vehicle-app-rust-sdk
- https://github.com/eclipse-kuksa/kuksa-databroker (`doc/protocol.md`, `doc/user_guide.md`) · https://github.com/eclipse-kuksa/kuksa-mock-provider · https://github.com/eclipse-kuksa/kuksa-rust-sdk
- https://github.com/COVESA/vehicle_signal_specification/releases (v4.0 … v6.1)
- https://scratch.mit.edu/discuss/post/8288467/ · https://www.scratchfoundation.org/open-source-license
- https://github.com/modelcontextprotocol/modelcontextprotocol · https://github.com/coder/code-server

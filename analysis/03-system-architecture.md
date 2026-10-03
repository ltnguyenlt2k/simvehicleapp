# 03 — Thiết kế tổng thể hệ thống (System Architecture)

> Bản vẽ tổng thể theo C4 (Context → Container → Component) + sequence cho các luồng chính.
> Tầng & module: [02-layers-and-modules](02-layers-and-modules.md). Hạ tầng compose: [12-docker-compose-and-infra](12-docker-compose-and-infra.md).

---

## 1. C4 — System Context

```mermaid
flowchart LR
  U(("Người dùng<br/>(kỹ sư ứng dụng xe,<br/>không cần biết C++)"))
  DEV(("Developer nâng cao"))
  SV["SimVehicleApp<br/>(Docker Compose)"]
  LLM[("LLM Provider<br/>Anthropic/OpenAI/Gemini/<br/>Ollama… qua .env")]
  MCPX[("MCP servers ngoài<br/>(tuỳ chọn)")]
  GH[("GitHub / Conan / ghcr.io<br/>(chỉ lúc build image<br/>hoặc online mode)")]
  VSS[("COVESA VSS releases")]
  EXT(("Claude Desktop/Code,<br/>agent ngoài"))

  U -- "browser :3000" --> SV
  DEV -- "IDE :8080 / download zip" --> SV
  SV -- "HTTPS (chat only)" --> LLM
  SV -- "MCP client" --> MCPX
  EXT -- "MCP (Streamable HTTP) :4300/mcp" --> SV
  SV -. "build-time" .-> GH
  SV -. "tải/pin VSS" .-> VSS
```

---

## 2. C4 — Container diagram

```mermaid
flowchart TB
  subgraph Browser
    UI["Studio SPA<br/>canvas · VSS toolbar · Run console ·<br/>Signal monitor · Chat · Diagnostics"]
  end

  subgraph core["compose: core"]
    STUDIO["studio :3000<br/>Next.js (Sim fork) + BFF /api/sv/*"]
    RT["realtime :3002<br/>Socket.io (collab)"]
    DB[("db :5432<br/>Postgres 17")]
    REDIS[("redis<br/>(optional)")]
    CAT["vss-catalog :4010"]
    COMP["compiler :4020<br/>graph→IR · diagnostics · simulator"]
    ORCH["orchestrator :4030<br/>projects · SynCode jobs · runs · SSE"]
    WS["workspace :4040<br/>single FS writer"]
  end

  subgraph lang["compose: lang-cpp (swap = lang-python…)"]
    CG["codegen-cpp :4110<br/>compiler-code-cpp"]
    TC["toolchain-cpp :4210<br/>velocitas agent: build/test/run"]
    IDE["ide-cpp :8080<br/>code-server + velocitas env"]
  end

  subgraph runtime["compose: runtime"]
    VDB["databroker :55555<br/>KUKSA 0.5.0 --enable-databroker-v1"]
    MQ["mqtt :1883/:9001<br/>mosquitto 2.0.14"]
    MOCK["mock-provider<br/>(profile)"]
    SG["signal-gateway :4050<br/>kuksa.val.v1 ↔ WebSocket"]
  end

  subgraph ai["compose: ai"]
    AIS["ai-assistant :4300<br/>chat · providers · MCP server /mcp"]
  end

  VOL[("volume sv-workspace<br/>/workspace")]
  CACHE[("volumes: sv-conan · sv-ccache · sv-vss")]

  UI --> STUDIO
  UI <-. socket .-> RT
  UI <-. "SSE (jobs/logs/trace)" .-> STUDIO
  UI <-. "WS (signals)" .-> STUDIO
  UI -- "iframe/new tab" --> IDE
  STUDIO --> DB
  RT --> DB
  STUDIO -- "/api/sv/*" --> ORCH & CAT & COMP & AIS & SG
  ORCH --> COMP
  COMP --> CAT
  ORCH --> CG
  ORCH --> WS
  ORCH --> TC
  ORCH --> DB
  WS --- VOL
  TC --- VOL
  IDE --- VOL
  TC --- CACHE
  IDE --- CACHE
  TC -- "app process: gRPC" --> VDB
  TC -- "app process: MQTT" --> MQ
  MOCK --> VDB
  SG --> VDB
  AIS --> ORCH & COMP & CAT
```

### 2.1 Bảng container
| Container | Module | Port (host bind 127.0.0.1) | Trách nhiệm | State |
|---|---|---|---|---|
| studio | simvehicleapp-studio | 3000 | UI + auth + lưu workflow (Sim DB) + BFF proxy | db |
| realtime | simvehicleapp-studio | 3002 | Socket collab của Sim | db |
| migrations | simvehicleapp-studio | — | Drizzle migrate (Sim + schema `sv`) | — |
| db | infra | 5432 (internal) | Postgres | `postgres_data` |
| vss-catalog | simvehicleapp-core | 4010 | Parse/cached VSS, tree/search/node API, modelHash | `sv-vss` |
| compiler | simvehicleapp-core | 4020 | Normalize graph, validate, IR, diagnostics, simulate | stateless |
| orchestrator | simvehicleapp-orchestrator | 4030 | Project, Generation, Run lifecycle; job queue; SSE | db (schema `sv`) |
| workspace | simvehicleapp-orchestrator | 4040 | Tạo project từ template, staging, atomic commit, AppManifest merge, zip export | `sv-workspace` |
| signal-gateway | simvehicleapp-orchestrator | 4050 | Subscribe/set VSS trên databroker, WS cho UI | stateless |
| codegen-cpp | compiler-code-cpp | 4110 | IR → C++ file set (thuần) | stateless |
| toolchain-cpp | velocitas-stack | 4210 | Agent chạy `velocitas`/Conan/CMake: init, build, test, run app, stream log | `sv-workspace`, `sv-conan`, `sv-ccache` |
| ide-cpp | ide-vscode | 8080 | code-server trên `/workspace/projects` | `sv-workspace`, `sv-ide-home` |
| databroker | velocitas-stack | 55555 | KUKSA Databroker | — |
| mqtt | velocitas-stack | 1883, 9001 | Mosquitto | — |
| mock-provider | velocitas-stack | — | Provider giả lập actuator/sensor (profile `mock`) | — |
| ai-assistant | simvehicleapp-ai | 4300 | Chat, agent loop, MCP server + client | db (schema `sv_ai`) |

---

## 3. Component view (các container quan trọng)

### 3.1 `compiler` (simvehicleapp-core)
```mermaid
flowchart LR
  IN["WorkflowGraph v1"] --> N["Normalizer<br/>(Sim BlockState/Edge → canonical graph)"]
  N --> V1["S1 Structural"] --> V2["S2 Block config"] --> V3["S3 Vehicle model<br/>(vss-catalog)"] --> V4["S4 Types"] --> V5["S5 Units<br/>(+ conversion nodes)"] --> V6["S6 Control flow"] --> V7["S7 Backend capability"]
  V7 --> IRB["IR Builder + hasher"] --> OUT["IR v1 + Diagnostics[]"]
  OUT --> SIM["Simulator<br/>(virtual clock)"]
  EXPR["expr: parser + typer"] -.-> V2 & V4 & IRB
```

### 3.2 `orchestrator` (simvehicleapp-orchestrator)
```mermaid
flowchart LR
  API["REST + SSE"] --> PJ["ProjectService"]
  API --> GEN["GenerationPipeline (SynCode)"]
  API --> RUN["RunManager"]
  GEN --> Q["JobQueue (Postgres-backed, 1 worker/lang)"]
  GEN --> BR["BackendRegistry<br/>(discover codegen-* via /capabilities)"]
  RUN --> TR["TraceIngest<br/>(parse SVTRACE lines → TraceEvent)"]
  PJ & GEN & RUN --> REPO[("sv schema")]
  API --> BUS["EventHub → SSE /events?projectId="]
```

### 3.3 `toolchain-<lang>` agent (velocitas-stack)
```mermaid
flowchart LR
  JAPI["POST /jobs {kind: init|deps|build|test|run|stop}"] --> EXE["JobExecutor<br/>(1 job build/lúc, 1 run/lúc)"]
  EXE --> CLI["velocitas / build.sh / install_dependencies.sh / ctest"]
  EXE --> PROC["ProcessSupervisor<br/>(app process, SIGINT stop)"]
  PROC --> LOG["LogStreamer → GET /jobs/:id/stream (SSE)"]
  CLI --> LOG
```

---

## 4. Luồng chính (Sequence)

### 4.1 Verify (validate nhanh — không build)
```mermaid
sequenceDiagram
  participant UI
  participant ST as studio(BFF)
  participant CO as compiler
  participant CA as vss-catalog
  UI->>ST: POST /api/sv/workflows/:id/verify
  ST->>ST: load BlockState/Edges từ DB → WorkflowGraph v1
  ST->>CO: POST /compile {graph, target:"cpp", mode:"verify"}
  CO->>CA: GET /nodes?paths=… (batch, cached)
  CA-->>CO: node metadata + modelHash
  CO->>CO: S1..S7 + IR
  CO-->>ST: {ok, irHash, diagnostics[]}
  ST-->>UI: diagnostics → badge trên block
```

### 4.2 SynCode (generate → workspace → build → test)
```mermaid
sequenceDiagram
  participant UI
  participant OR as orchestrator
  participant CO as compiler
  participant CG as codegen-cpp
  participant WS as workspace
  participant TC as toolchain-cpp
  UI->>OR: POST /projects/:pid/generations {workflowIds[]}
  OR-->>UI: 202 {generationId} (SSE stream bắt đầu)
  OR->>CO: POST /compile (mode:"build") cho từng workflow
  CO-->>OR: IR[] (hoặc diagnostics → FAIL stage=ir)
  OR->>CG: POST /generate {project IR bundle, options}
  CG-->>OR: GeneratedFileSet {files[], manifestFragment, sourceMaps}
  OR->>WS: POST /projects/:pid/commits {generationId, files, manifestFragment}
  WS->>WS: stage → verify paths → merge AppManifest → atomic rename → generation manifest
  WS-->>OR: {commitId, changedFiles}
  OR->>TC: POST /jobs {kind:"build", project, generationId}
  TC-->>OR: SSE log (conan, cmake, compiler)
  OR->>OR: map lỗi compiler → blockId (source map)
  OR->>TC: POST /jobs {kind:"test"}
  TC-->>OR: ctest result
  OR-->>UI: SSE generation.completed {verification:{ir,format,compile,tests}, editorUrl}
```

### 4.3 Live Run (headless, không mở IDE)
```mermaid
sequenceDiagram
  participant UI
  participant OR as orchestrator
  participant TC as toolchain-cpp
  participant APP as vehicle app (process)
  participant VDB as databroker
  participant SG as signal-gateway
  UI->>OR: POST /projects/:pid/runs {generationId}
  OR->>TC: POST /jobs {kind:"run", artifact:"build/bin/app", env:SDV_*}
  TC->>APP: spawn (SDV_VEHICLEDATABROKER_ADDRESS=grpc://databroker:55555)
  APP->>VDB: subscribe Vehicle.Speed …
  UI->>SG: WS subscribe [paths]  (qua studio proxy)
  UI->>SG: set Vehicle.Speed=130 (inject)
  SG->>VDB: Set current value
  VDB-->>APP: update
  APP->>APP: workflow chạy (runtime lib)
  APP-->>TC: stdout: SVTRACE {...} + log
  TC-->>OR: SSE lines
  OR-->>UI: SSE run.log / run.trace → highlight block
  APP->>VDB: set Vehicle.ADAS...(actuator)
  VDB-->>SG: update target/current
  SG-->>UI: signal update
  UI->>OR: POST /runs/:rid/stop → TC SIGINT → app.stop()
```

### 4.4 Simulate (không build, chạy IR)
```mermaid
sequenceDiagram
  participant UI
  participant CO as compiler(simulator)
  UI->>CO: POST /simulate {ir, scenario:{inputs:[{t:0,path,value}…], until:"60s"}}
  CO->>CO: virtual clock chạy tới until, ghi TraceEvent[]
  CO-->>UI: {trace[], writes[], logs[], finalState}
  UI->>UI: timeline + replay highlight trên canvas
```

### 4.5 AI Chat tạo workflow
```mermaid
sequenceDiagram
  participant UI as Chat panel
  participant AI as ai-assistant
  participant LLM
  participant CA as vss-catalog (MCP tool)
  participant CO as compiler (MCP tool)
  UI->>AI: "Cảnh báo khi pin < 20% và xe đang chạy"
  AI->>LLM: messages + tools (vss.search, workflow.propose_patch, workflow.validate…)
  LLM-->>AI: tool_call vss.search("state of charge")
  AI->>CA: search
  CA-->>AI: Vehicle.Powertrain.TractionBattery.StateOfCharge.Current …
  LLM-->>AI: tool_call workflow.propose_patch(ops…)
  AI->>CO: validate(patch applied on draft)
  CO-->>AI: diagnostics
  AI-->>UI: WorkflowPatch preview (diff trên canvas) + giải thích
  UI->>UI: user Accept → apply vào workflow store (Sim)
```

---

## 5. Mô hình dữ liệu (schema `sv` trong Postgres)

```mermaid
erDiagram
  PROJECT ||--o{ PROJECT_WORKFLOW : contains
  PROJECT ||--o{ GENERATION : has
  GENERATION ||--o{ GENERATION_STAGE : has
  GENERATION ||--o{ RUN : produces
  RUN ||--o{ RUN_EVENT : logs
  PROJECT {
    uuid id
    text slug
    text language "cpp|python|rust"
    text vss_release "v4.0"
    text model_hash
    text template_sha
    text workspace_path "/workspace/projects/<slug>"
    jsonb settings "app name, mqtt prefix, trace level, license tier"
  }
  PROJECT_WORKFLOW {
    uuid project_id
    text sim_workflow_id "FK → Sim workflow table"
    bool enabled
    text concurrency_default
  }
  GENERATION {
    uuid id
    int workflow_revision
    text ir_hash
    text compiler_version
    text backend_id "codegen-cpp@0.1.0"
    text status "queued|running|passed|failed|cancelled"
    jsonb verification
    jsonb diagnostics
  }
  GENERATION_STAGE {
    text name "ir|codegen|write|deps|build|test"
    timestamptz started
    timestamptz ended
    text status
  }
  RUN {
    uuid id
    text status "starting|running|stopped|crashed"
    int exit_code
  }
  RUN_EVENT {
    bigint seq
    text kind "log|trace|signal|system"
    jsonb payload
  }
```
- Workflow graph **vẫn lưu ở bảng của Sim** (không nhân bản). `sv` chỉ lưu metadata project/generation/run.
- `RUN_EVENT` lưu có giới hạn (ring buffer 50k dòng/run, cấu hình).

---

## 6. Workspace layout (volume `sv-workspace`)

```
/workspace
├── projects/
│   └── <slug>/                        # = một Velocitas vehicle app (copy từ template pin)
│       ├── .velocitas.json            # đọc-chỉ với SimVehicleApp (chỉ tạo 1 lần lúc init)
│       ├── conanfile.txt  CMakeLists.txt  build.sh  install_dependencies.sh  requirements.txt
│       ├── app/
│       │   ├── AppManifest.json       # merge có kiểm soát
│       │   ├── CMakeLists.txt
│       │   ├── src/
│       │   │   ├── CMakeLists.txt     # overlay 1 lần: include(generated/generated.cmake) + user/
│       │   │   ├── generated/         # DO NOT EDIT — sở hữu bởi SynCode
│       │   │   ├── user/              # hook người dùng, không bao giờ bị ghi đè
│       │   │   └── simvehicleapp-runtime/# vendored runtime lib (pin version)
│       │   └── tests/ (utests/ + generated/)
│       ├── .simvehicleapp/project.json   # metadata project (id, language, versions)
│       └── build-linux-x86_64/ … build/   # output toolchain (không commit)
├── .sv/staging/<generationId>/        # staging nội bộ workspace-service
├── .sv/generations/<slug>/<generationId>.json
└── exports/<slug>-<generationId>.zip
```

---

## 7. API bề mặt (tóm tắt; schema đầy đủ trong `simvehicleapp-contracts`)

| Service | Endpoint | Mô tả |
|---|---|---|
| vss-catalog | `GET /releases`, `GET /tree?release=&prefix=&depth=`, `GET /search?q=&type=`, `GET /nodes?paths=`, `GET /model-hash?release=` | Toolbar & validator dùng chung |
| compiler | `POST /compile`, `POST /simulate`, `POST /lint`, `GET /blocks` (catalog block definitions), `GET /opcodes` | thuần |
| codegen-* | `GET /capabilities`, `POST /generate`, `GET /runtime/files`, `GET /template-overlay/files` | Backend Plugin contract (ADR-0020 §2) |
| workspace | `POST /projects` (init từ template), `POST /projects/:slug/commits`, `GET /projects/:slug/tree`, `POST /projects/:slug/export`, `POST /projects/:slug/rollback` | single writer |
| toolchain-* | `POST /jobs`, `GET /jobs/:id`, `GET /jobs/:id/stream`, `POST /jobs/:id/cancel` | build/test/run |
| orchestrator | `/projects`, `/projects/:id/generations`, `/projects/:id/runs`, `/events` (SSE) | ứng dụng |
| signal-gateway | `WS /signals` (subscribe/set/unsubscribe), `GET /snapshot?paths=` | realtime |
| ai-assistant | `POST /chat` (SSE stream), `GET /conversations`, `/mcp` (MCP Streamable HTTP) | AI |
| studio BFF | `/api/sv/*` → proxy có auth tới các service trên | biên giới bảo mật |

Tất cả service nội bộ **chỉ nghe trên network compose** (không publish port), trừ `studio`, `ide-*`, (tuỳ chọn) `ai-assistant/mcp` — và đều bind `127.0.0.1` mặc định.

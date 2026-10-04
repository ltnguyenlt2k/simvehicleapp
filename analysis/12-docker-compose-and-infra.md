# 12 — Docker Compose & hạ tầng (mode chạy duy nhất)

> **Trạng thái thực tế (M0, 2026-10-01):** đã hiện thực bằng root `docker-compose.yml` + fragment từng module (ADR-0009): `modules/velocitas-stack/compose.yaml`, `modules/ide-vscode/compose.yaml`, `modules/simvehicleapp-studio/compose.simvehicleapp.yaml`. Các khung YAML bên dưới là thiết kế đích cho các service chưa có (core, orchestrator, ai…); khi khác biệt, file compose thật là nguồn sự thật.

> FR-PLT-02. Quyết định: [ADR-0005](adr/ADR-0005-docker-compose-only.md), [ADR-0024](adr/ADR-0024-databroker-api-and-runtime-stack.md), [ADR-0025](adr/ADR-0025-headless-velocitas-toolchain.md).

---

## 1. Compose profiles
| Profile | Services | Khi nào |
|---|---|---|
| (mặc định) core | db, migrations, studio, realtime, vss-catalog, compiler, orchestrator, workspace | luôn |
| `cpp` (mặc định bật qua `COMPOSE_PROFILES`) | codegen-cpp, toolchain-cpp, ide-cpp | ngôn ngữ C++ |
| `python` | codegen-python, toolchain-python, ide-python | M12 |
| `runtime` (mặc định bật) | databroker, mqtt, signal-gateway | Live Run |
| `mock` | mock-provider | cần provider actuator |
| `ai` | ai-assistant | có API key |
| `redis` | redis | scale realtime |

`.env`: `COMPOSE_PROFILES=cpp,runtime,ai`.

## 2. `compose/compose.yaml` (bản khung — agent hoàn thiện ở M0/M7)
```yaml
name: simvehicleapp
include:
  - compose.core.yaml
  - compose.runtime.yaml
  - compose.lang-cpp.yaml
  - compose.ai.yaml
networks:
  internal: { internal: true }          # không ra internet
  edge: {}                              # có egress (studio, ai-assistant, toolchain lúc online)
volumes:
  postgres_data: {}
  sv-workspace: {}
  sv-conan: {}
  sv-ccache: {}
  sv-vss: {}
  sv-ide-home: {}
```

```yaml
# compose.core.yaml (trích)
services:
  db:
    image: pgvector/pgvector:pg17
    environment: [POSTGRES_USER=postgres, POSTGRES_PASSWORD=${POSTGRES_PASSWORD}, POSTGRES_DB=simvehicleapp]
    volumes: [postgres_data:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL","pg_isready -U postgres"], interval: 5s, retries: 10 }
    networks: [internal]
  migrations:
    build: { context: ../modules/simvehicleapp-studio, dockerfile: docker/migrations.Dockerfile }
    command: ["bun","run","db:migrate"]
    depends_on: { db: { condition: service_healthy } }
    networks: [internal]
  studio:
    build: { context: ../modules/simvehicleapp-studio, dockerfile: docker/app.Dockerfile }
    ports: ["127.0.0.1:${SV_STUDIO_PORT:-3000}:3000"]
    env_file: [../.env]
    environment:
      - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/simvehicleapp
      - SV_ORCHESTRATOR_URL=http://orchestrator:4030
      - SV_CATALOG_URL=http://vss-catalog:4010
      - SV_COMPILER_URL=http://compiler:4020
      - SV_SIGNAL_GATEWAY_URL=ws://signal-gateway:4050
      - SV_AI_URL=http://ai-assistant:4300
      - SOCKET_SERVER_URL=http://realtime:3002
    depends_on: { migrations: { condition: service_completed_successfully }, realtime: { condition: service_healthy } }
    networks: [internal, edge]
  realtime:
    build: { context: ../modules/simvehicleapp-studio, dockerfile: docker/realtime.Dockerfile }
    ports: ["127.0.0.1:3002:3002"]
    networks: [internal, edge]
  vss-catalog:   # thực tế: modules/simvehicleapp-core/compose.yaml (M02-T04)
    build:
      context: .   # modules/simvehicleapp-core
      dockerfile: services/vss-catalog/Dockerfile
      additional_contexts: { contracts: "docker-image://${SV_CONTRACTS_IMAGE:-simvehicleapp/contracts:dev}" }
    environment: [INTERNAL_API_SECRET, SV_VSS_DEFAULT_RELEASE=v4.0, SV_VSS_HTTP=0]   # seed v4.0/v4.2 nằm trong image: /opt/sv/vss/<vX.Y>/
    volumes: [sv-vss:/var/cache/sv-vss]   # cache cho HttpSource (chỉ release có pin sha256)
    networks: [internal]
  compiler:
    build: { context: ../modules/simvehicleapp-core, dockerfile: services/compiler/Dockerfile }
    environment: [SV_CATALOG_URL=http://vss-catalog:4010, SV_BACKENDS=cpp=http://codegen-cpp:4110]
    networks: [internal]
  orchestrator:
    build: { context: ../modules/simvehicleapp-orchestrator, dockerfile: services/orchestrator/Dockerfile }
    environment:
      - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/simvehicleapp
      - SV_COMPILER_URL=http://compiler:4020
      - SV_WORKSPACE_URL=http://workspace:4040
      - SV_BACKENDS=cpp=http://codegen-cpp:4110
      - SV_TOOLCHAINS=cpp=http://toolchain-cpp:4210
      - SV_IDE_PUBLIC_URL=http://localhost:${SV_IDE_PORT:-8080}
      - SV_LICENSE_MODE=full
    depends_on: { migrations: { condition: service_completed_successfully } }
    networks: [internal]
  workspace:
    build: { context: ../modules/simvehicleapp-orchestrator, dockerfile: services/workspace/Dockerfile }
    user: "4000:4000"   # = vscode in the Velocitas image (verified M0)
    volumes: [sv-workspace:/workspace]
    environment: [SV_WORKSPACE_ROOT=/workspace, SV_TEMPLATES_URL=http://toolchain-cpp:4210/templates]
    networks: [internal]
```

```yaml
# compose.runtime.yaml
services:
  databroker:
    image: ghcr.io/eclipse-kuksa/kuksa-databroker:0.5.0
    command: ["--insecure", "--enable-databroker-v1", "--vss", "/vss/vss_rel_4.0.json"]   # SPIKE S-2: xác minh cờ trên 0.5.0 (runtime-local dùng env KUKSA_DATABROKER_METADATA_FILE)
    volumes: [./config/vss:/vss:ro]
    ports: ["127.0.0.1:55555:55555"]
    networks: [internal]
    profiles: [runtime]
  mqtt:
    image: eclipse-mosquitto:2.0.14
    command: ["mosquitto","-c","/mosquitto-no-auth.conf"]
    ports: ["127.0.0.1:1883:1883", "127.0.0.1:9001:9001"]
    networks: [internal]
    profiles: [runtime]
  mock-provider:
    image: ghcr.io/eclipse-kuksa/kuksa-mock-provider/mock-provider:0.4.1
    environment: [VDB_ADDRESS=databroker:55555]   # SPIKE S-4: xác minh tên biến/arg kết nối của mock-provider 0.4.1
    volumes: [./config/mock/mock.py:/mock.py:ro]
    networks: [internal]
    profiles: [mock]
  signal-gateway:
    build: { context: ../modules/simvehicleapp-orchestrator, dockerfile: services/signal-gateway/Dockerfile }
    environment: [SV_DATABROKERS=v4.0=databroker:55555]   # thêm databroker-v4-2… theo ADR-0024 §6
    networks: [internal]
    profiles: [runtime]
```

```yaml
# compose.lang-cpp.yaml
services:
  codegen-cpp:
    build: { context: ../modules/compiler-code-cpp }
    networks: [internal]                     # không egress (nguyên tắc no-LLM)
    profiles: [cpp]
  toolchain-cpp:
    build: { context: ../modules/velocitas-stack, dockerfile: toolchain/cpp/Dockerfile }
    user: "4000:4000"   # = vscode in the Velocitas image (verified M0)
    environment:
      - SV_WORKSPACE_ROOT=/workspace
      - VELOCITAS_OFFLINE=${VELOCITAS_OFFLINE:-1}
      - GITHUB_API_TOKEN=${GITHUB_API_TOKEN:-}
      - SV_RUN_ENV=SDV_MIDDLEWARE_TYPE=native;SDV_VEHICLEDATABROKER_ADDRESS=grpc://databroker:55555;SDV_MQTT_ADDRESS=mqtt://mqtt:1883
    volumes: [sv-workspace:/workspace, sv-conan:/home/vscode/.conan2, sv-ccache:/home/vscode/.ccache]
    networks: [internal, edge]               # edge chỉ cần khi VELOCITAS_OFFLINE=0
    profiles: [cpp]
  ide-cpp:
    build: { context: ../modules/ide-vscode, dockerfile: cpp/Dockerfile, args: { TOOLCHAIN_IMAGE: simvehicleapp/toolchain-cpp:local } }
    ports: ["127.0.0.1:${SV_IDE_PORT:-8080}:8080"]
    environment: [PASSWORD=${SV_IDE_PASSWORD}]
    volumes: [sv-workspace:/workspace, sv-conan:/home/vscode/.conan2, sv-ccache:/home/vscode/.ccache, sv-ide-home:/home/vscode/.local/share/code-server]
    networks: [internal, edge]
    profiles: [cpp]
```
> Lưu ý: `ide-cpp` dùng image toolchain ⇒ dev dùng `scripts/sv build` để build base/toolchain trước các image còn lại. `scripts/bootstrap.sh` là đầu việc release M11-T10, hiện chưa có.

## 3. `.env.example` (đầy đủ)
```dotenv
# ===== Core =====
COMPOSE_PROFILES=cpp,runtime
POSTGRES_PASSWORD=change-me
BETTER_AUTH_SECRET=            # openssl rand -hex 32
ENCRYPTION_KEY=                # openssl rand -hex 32
INTERNAL_API_SECRET=           # openssl rand -hex 32
API_ENCRYPTION_KEY=            # openssl rand -hex 32
NEXT_PUBLIC_APP_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000
DISABLE_AUTH=false             # true = single-user local, KHÔNG dùng khi share mạng
SV_STUDIO_PORT=3000
# ===== IDE =====
SV_IDE_PORT=8080
SV_IDE_PASSWORD=change-me
# ===== Velocitas / toolchain =====
VELOCITAS_OFFLINE=1            # 1 = dùng cache đã bake trong image
GITHUB_API_TOKEN=              # chỉ cần khi build image/online (tránh rate limit)
SV_VSS_DEFAULT_RELEASE=v4.0
# ===== License =====
SV_LICENSE_MODE=full           # full | enforce
SV_LICENSE_KEY=
# ===== AI (xem analysis/09, ADR-0030) =====
SV_AI_ENABLED=false
SV_AI_PROVIDER=anthropic       # anthropic | openai-compatible | gemini
SV_AI_MODEL=
ANTHROPIC_API_KEY=
OPENAI_COMPAT_BASE_URL=        # OpenAI/Azure/OpenRouter, hoặc server tự host/tunnel (Ollama/LiteLLM/vLLM)
OPENAI_COMPAT_API_KEY=
GEMINI_API_KEY=                # định dạng mới "AQ." — gọi native API, không qua lớp OpenAI-compatible của Google
SV_AI_MAX_TOOL_STEPS=6
SV_AI_RATE_LIMIT_PER_MINUTE=20 # theo user/session, không theo IP
SV_MCP_SERVER_ENABLED=false
SV_MCP_SERVER_TOKEN=
SV_MCP_CLIENTS=[]
```

## 4. Bootstrap

Lệnh dev hiện có (sau khi clone repo):

```bash
cp .env.example .env
scripts/sv build
scripts/sv up
scripts/sv smoke
```

Chỉnh `.env` theo môi trường; URL theo port đã cấu hình. `scripts/sv smoke` gọi `spikes/smoke.sh` (M0), chưa kiểm chuỗi vehicle UI/SynCode. Source build studio còn giới hạn ghi ở [spike report §8](../docs/spikes/M0-spikes-report.md#8-sim-from-source).

Quy trình **release dự kiến** dưới đây phụ thuộc scripts M11-T10, chưa phải lệnh chạy được trong checkout dev:
```bash
git clone --recurse-submodules <meta-repo> simvehicleapp && cd simvehicleapp
cp .env.example .env && scripts/gen-secrets.sh >> .env
scripts/bootstrap.sh          # lock-verify → build images theo thứ tự (toolchain trước ide) → compose up -d → smoke test
open http://localhost:3000
```
Smoke test (`scripts/smoke.sh`): healthz mọi service; tạo project mẫu; SynCode GW-A; run 10 s; inject Speed=130 trong 3 s; kiểm tra thấy `Hazard.IsSignaling=true` qua signal-gateway.

## 5. Bảo mật hạ tầng
- Mọi port publish bind `127.0.0.1`; muốn chia sẻ LAN → đặt reverse proxy TLS (Caddy) + auth (P2 profile `gateway`).
- Container non-root (uid 4000 = `vscode` của image Velocitas, verified M0); `read_only: true` cho codegen/compiler; `cap_drop: [ALL]`.
- Network `internal` không egress; chỉ `studio`, `ai-assistant`, `toolchain-*` (khi online), `ide-*` có `edge`.
- Workspace-service là service duy nhất có quyền ghi source; toolchain ghi `build*/` (được phép), IDE ghi mọi nơi (người dùng chủ động) → workspace-service phát hiện chỉnh tay trong `generated/` (checksum khác manifest) và cảnh báo `GENERATED_FILE_MODIFIED` trước khi ghi đè.

# OPERATIONS — chạy, cập nhật và theo dõi stack SimVehicleApp

Docker Compose là cách chạy duy nhất (AGENTS §2.10). Mọi cổng bind `127.0.0.1`; không mount `docker.sock`.

## 1. Khởi động
```bash
scripts/sv init             # .env từ .env.example + secret ngẫu nhiên (build/up cũng tự làm); đổi cổng/mật khẩu IDE nếu cần
scripts/sv build            # dựng image theo thứ tự (contracts → devcontainer/toolchain → còn lại)
scripts/sv up               # docker compose up -d (docker-compose.yml include các module)
scripts/sv smoke            # S-1/S-2: project offline → build → chạy app ↔ databroker/MQTT
scripts/sv smoke live       # gate M7 (SynCode) + M8 (GW-A live)
```
Máy ít RAM: image studio dựng trong CI; `scripts/sv refresh` lấy image studio của CI run tương ứng HEAD (artifact
`studio-image`), dựng lại các image nhỏ và `compose up -d` — **giữ nguyên volume**.

## 2. Cổng (host, chỉ 127.0.0.1)
| Cổng | Service | Ghi chú |
|---|---|---|
| 3000 | studio | UI + BFF `/api/sv/*` |
| 3002 | studio-realtime | cộng tác trên canvas |
| 8080 | ide-cpp | code-server (mật khẩu `SV_IDE_PASSWORD`) |
| 4300 | ai-assistant | chỉ `/mcp` cho agent ngoài (bearer `SV_MCP_TOKEN`); phần còn lại cần secret nội bộ |
| 55555 | databroker (VSS v4.0) | KUKSA 0.5.0, cho công cụ dev |
| 1883 / 9001 | mqtt | Mosquitto |

Service nội bộ (vss-catalog 4010, compiler 4020, orchestrator 4030, workspace 4040, signal-gateway 4050, codegen-cpp 4110,
toolchain-cpp 4210) **không** publish ra host; chỉ nhận request có `x-sv-internal = INTERNAL_API_SECRET`.

## 3. Cấu hình chính (`.env`)
| Biến | Ý nghĩa |
|---|---|
| `INTERNAL_API_SECRET` | secret giữa các service (thiếu ⇒ mọi request bị từ chối) |
| `SV_AI_PROVIDER`, `SV_AI_MODEL`, khoá provider | trợ lý AI: `anthropic`, `openai`, `openai-compatible`, `ollama`, `gemini`, `fake` (giả lập, không model) |
| `SV_MCP_TOKEN` / `SV_MCP_TOKENS` | bật `/mcp` cho agent ngoài |
| `SV_LICENSE_MODE`, `SV_LICENSE_KEY`, `SV_LICENSE_PUBLIC_KEY` | `full` (mặc định) hoặc `enforce` (ADR-0031) |
| `SV_DATABROKERS` | release VSS ⇒ databroker (`v4.0=databroker:55555,v4.2=databroker-v4-2:55555`) |

## 4. System status
Trang **System status** (thanh bên studio) và `GET /api/sv/system`: health, độ trễ, version, commit (`SV_COMMIT`), contracts
của mọi service — trực tiếp từ BFF hoặc qua orchestrator `GET /system`.

## 5. Log, metrics, truy vết
- Log: JSON một dòng (`docker compose logs <service>`), trường `requestId`. Một SynCode dùng `generationId` (`g_…`) làm
  request id ở **mọi** service nó gọi: `docker compose logs | grep g_<id>`.
- Metrics Prometheus: `GET /metrics` của từng service trong mạng nội bộ, ví dụ
  `docker run --rm --network simvehicleapp_sv-internal curlimages/curl -s http://orchestrator:4030/metrics`.
  Chính: `sv_syncode_stage_duration_ms`, `sv_syncode_generations_total{result,code}`, `sv_runs_ended_total`,
  `sv_run_trace_events_total`, `sv_toolchain_job_duration_ms`, `sv_http_requests_total`.

## 6. Dữ liệu và sao lưu
Volume: `studio-db` (Postgres: studio + schema `sv`, `sv_ai`), workspace projects, cache conan/velocitas, `sv-vss`.
- **Không bao giờ** `docker compose down -v` trên stack đang dùng (xoá DB và mọi project). Thử nghiệm phá huỷ: dùng
  project compose riêng `docker compose -p sv-ci-<x>`.
- Sao lưu DB: `docker compose exec studio-db pg_dump -U postgres simvehicleapp > backup.sql`.
- Project: thư mục trong volume workspace; **Export** (zip) từ studio là bản mang đi được.
- `scripts/sv reset-caches`: chỉ xoá volume cache conan/velocitas (sau khi dựng lại image toolchain).

## 7. Kiểm thử trên stack
| Lệnh | Kiểm |
|---|---|
| `modules/simvehicleapp-orchestrator/gate/m7-gate.sh` … `m9-gate.sh` | gate milestone |
| `modules/simvehicleapp-orchestrator/gate/parity-p3.sh [GW-A,…]` | parity P3 (ADR-0042) |
| `modules/simvehicleapp-orchestrator/gate/bench-nfr02.sh` | hiệu năng NFR-02 |

## 8. Sự cố thường gặp
- **WSL: đồng hồ thực nhảy ~1 s/phút** — đo thời gian dài bằng giờ thực bị lệch; P3 tự phát hiện và chạy lại.
- **Service "unhealthy" sau cập nhật**: `docker compose logs --tail 100 <service>`; `INTERNAL_API_SECRET` phải giống nhau ở mọi service.
- **SynCode lỗi `GENERATED_FILE_MODIFIED`**: file sinh ra bị sửa tay (IDE) — SynCode lại với ghi đè, hoặc đưa thay đổi vào workflow.
- **Run không sang `running` trong 30 s** (`RUN_START_TIMEOUT`): xem Run console / `docker compose logs toolchain-cpp`.

---
name: docker-compose-stack
description: Edit or diagnose SimVehicleApp Compose fragments, Dockerfiles, toolchain images, runtime services and bootstrap scripts.
---

# Docker Compose stack

Tham chiếu: `analysis/12-docker-compose-and-infra.md`, ADR-0005/0024/0025/0028.

## Luật
- Compose là mode chạy duy nhất; entry **root `docker-compose.yml`** chỉ `include:` fragment của từng module (`modules/<m>/compose.yaml`, fork Sim: `compose.simvehicleapp.yaml`) — ADR-0009. Mỗi fragment phải `docker compose -f <fragment> config -q` được độc lập (khai báo lại network/volume dùng chung).
- Không container nào mount `/var/run/docker.sock`; không `privileged`.
- Port publish bind `127.0.0.1`; service nội bộ chỉ ở network `internal` (không egress). Egress chỉ: studio, ai-assistant, toolchain (online mode), ide.
- Non-root **uid 4000** cho workspace/toolchain/ide (= user `vscode` của image Velocitas, verified M0). Mọi mount point volume phải tồn tại sẵn trong image, owner vscode.
- Image upstream pin tag + digest (xem `docs/BASELINE.md`): devcontainer-base cpp:v0.4, kuksa-databroker 0.5.0, mosquitto 2.0.14, mock-provider 0.4.1, code-server 4.139.1.

## Thứ tự build
devcontainer-cpp (template `.devcontainer`) → toolchain-cpp → ide-cpp (`docker-image://` toolchain) → phần còn lại: `scripts/sv build`. Sau khi rebuild toolchain, cache cũ có thể cần reseed; `scripts/sv reset-caches` **xoá volume cache và dừng stack**, chỉ chạy khi cần và việc xoá đã được cho phép. Không reset mặc định.

## Bẫy đã gặp (M0)
- `./build.sh` trả 0 khi CMake fail → kiểm `build/bin/app`.
- Volume mount vào path không có trong image → root-owned.
- `additional_contexts: service:<x>` không được trỏ tới service nằm trong profile tắt.
- Offline: `VELOCITAS_OFFLINE=1` kích hoạt wheelhouse, SDK mirror, conan `sv-offline` remote (sv-entrypoint).
- Smoke: `scripts/sv smoke`.

## Runtime stack
databroker `--insecure --enable-databroker-v1 --vss /vss/<release>.json` (1 databroker/VSS release, map `SV_DATABROKERS`); app env `SDV_MIDDLEWARE_TYPE=native`, `SDV_VEHICLEDATABROKER_ADDRESS=grpc://databroker:55555`, `SDV_MQTT_ADDRESS=mqtt://mqtt:1883`.

## Debug nhanh
```bash
docker compose ps
docker compose logs --tail 100 <service>
docker compose exec toolchain-cpp bash -lc 'cd /workspace/projects/<slug> && ./build.sh'
curl -s localhost:3000/api/sv/health | jq
```

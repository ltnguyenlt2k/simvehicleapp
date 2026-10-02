# ADR-0005: Docker Compose là mode chạy duy nhất (không devcontainer)

- **Status:** Accepted (2026-10-01 — verify đầy đủ trong M0: `scripts/sv build/up/smoke`, không container nào mount docker.sock, xem [M0 spike report](../../docs/spikes/M0-spikes-report.md)) · **Date:** 2026-09-30 · **Level:** L0
- **Related:** FR-PLT-02; [12](../12-docker-compose-and-infra.md); ADR-0025

## Context
PO: "chỉ cần một mode chạy bằng docker compose / có thể không cần mode devcontainer". Sim có `.devcontainer`, helm, 3 file compose; Velocitas template dựa vào devcontainer (`onCreateCommand` chạy `velocitas init/sync`) và `runtime-local` (docker-in-docker, network host).

## Decision
1. Một entrypoint duy nhất: `compose/compose.yaml` (include các file theo nhóm) + `COMPOSE_PROFILES`.
2. Gỡ `.devcontainer/`, `helm/`, `docker-compose.{local,ollama,prod}.yml` khỏi studio fork.
3. Velocitas: thay devcontainer bằng **toolchain image** (ADR-0025) và thay `runtime-local` bằng **services compose** (ADR-0024). Không cần Docker socket trong bất kỳ container nào.
4. Dev của từng module có thể chạy module standalone (`bun dev`), nhưng *tích hợp* luôn qua compose.
5. Gói export giữ `.devcontainer` của template cho người nhận (không phải mode chạy của SimVehicleApp).

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| Kubernetes/Helm | Ngoài phạm vi v1; có thể thêm sau từ compose |
| Devcontainer cho Velocitas + compose cho Sim | 2 mode, trái yêu cầu; cần VS Code desktop |
| Docker-in-docker để giữ runtime-local | Cần privileged + socket ⇒ rủi ro bảo mật |

## Consequences
+ Đơn giản, 1 lệnh. + Không cần privileged. − Phải tự tái hiện những gì devcontainer làm (bake trong image). − Scale ngang hạn chế (chấp nhận cho v1).

## Implementation
| Task | Milestone |
|---|---|
| Compose skeleton + profiles + networks + volumes | M0 |
| bootstrap.sh / smoke.sh | M0 → M8 |

## Verification
Máy sạch chỉ có Docker Engine + Compose v2: `scripts/sv build && scripts/sv up` thành công; không container nào mount `/var/run/docker.sock` (CI kiểm tra compose config).

## Notes / Deviations (2026-10-01)
Thực tế M0 dùng cấu trúc theo [ADR-0009](ADR-0009-dev-phase-module-folders.md): entrypoint là **root `docker-compose.yml`** (`include:` các fragment `modules/<m>/compose.yaml`), không phải `compose/compose.yaml` như phác thảo ban đầu ở [12-docker-compose-and-infra.md](../12-docker-compose-and-infra.md). Script điều phối là `scripts/sv` (không phải `scripts/bootstrap.sh`/`scripts/smoke.sh` riêng — đã gộp vào `scripts/sv build|up|down|smoke|reset-caches`). Đã verify thật: build toolchain-cpp (3 phút 20s lần đầu), build offline project mới (`--network none`), chạy app ↔ databroker/MQTT, không service nào mount docker.sock.

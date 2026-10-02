# M0 — Foundations (meta-repo, repo con, contracts, spikes)

**Mục tiêu:** có khung hệ thống multi-repo chạy được bằng compose (service rỗng), baseline được khoá, contract v1 draft, các rủi ro kỹ thuật lớn nhất được spike.
**ADR phải Accepted:** 0001–0007 (0024/0025/0028 cập nhật theo kết quả spike).
**Phụ thuộc:** không.

## Tasks
| ID | Task | Module | Kết quả / File | Test |
|---|---|---|---|---|
| M00-T01 | Khởi tạo meta-repo từ thư mục hiện tại: `README.md`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `docs/`, `compose/`, `scripts/` | meta | cấu trúc [02 §5](../02-layers-and-modules.md#5-cấu-trúc-meta-repo-simvehicleapp) | — |
| M00-T02 | Tạo 10 repo con từ "module template" (README, CONTRACT, AGENTS, CI, Dockerfile, `/healthz`, `/version`) | all | repos + submodule trong `modules/` | CI xanh mỗi repo |
| M00-T03 | `simvehicleapp.lock.yaml`, `scripts/modules.sh`, `scripts/lock-verify.sh` | meta | | lock-verify pass/fail cố ý |
| M00-T04 | `docs/BASELINE.md`: SHA Sim `ad0b8678…`, template C++ `275e858…`, Python `e7082f7…`, SDK 0.7.1 `6323b65…`, digest images (devcontainer-base cpp:v0.4, databroker 0.5.0, mosquitto 2.0.14, mock-provider 0.4.1) | meta | | — |
| M00-T05 | Contracts v1-alpha: workflow-graph, ir, diagnostics, block-spec, generated-fileset, backend-capabilities, toolchain-job, trace-event, log-line, signal-update, scenario, workflow-patch; OpenAPI skeleton mọi service; gen TS types; `service-kit` | contracts | `@simvehicleapp/contracts@1.0.0-alpha.1` | ajv validate fixtures |
| M00-T06 | Fixtures: `vss_rel_4.0.json` + units seed; golden GW-A graph.json + scenario.yaml (viết tay) | contracts | | schema validate |
| M00-T07 | Compose skeleton: networks internal/edge, volumes, mọi service dạng "hello" (healthz) + db | meta | `compose/*.yaml` | `docker compose up` → mọi healthz 200 |
| M00-T08 | CI chung: license scan, `contract-only-deps`, compose lint (không docker.sock, bind 127.0.0.1) | meta + all | | |
| M00-T09 | **Spike S-1** toolchain headless offline | velocitas-stack | `docs/spikes/S-1.md` + Dockerfile nháp | build template 2 lần (online, `--network none`) |
| M00-T10 | **Spike S-2** databroker 0.5.0 + mosquitto trong compose + app sample template | velocitas-stack | `docs/spikes/S-2.md` | app log "Speed" khi set qua databroker-cli |
| M00-T11 | **Spike S-3** hành vi `set()` sdv v1 (current vs target) quan sát bằng kuksa.val.v1 | velocitas-stack | `docs/spikes/S-3.md` | bảng kết quả |
| M00-T12 | **Spike S-4** mock-provider 0.4.1 | velocitas-stack | `docs/spikes/S-4.md` | |
| M00-T13 | **Spike S-5** Sim v0.7.13 chạy tối giản trong compose (không Trigger.dev/pii) | studio | `docs/spikes/S-5.md` | login + tạo workflow + lưu |
| M00-T14 | **Spike S-6** code-server FROM toolchain + clangd | ide-vscode | `docs/spikes/S-6.md` | go-to-definition vào SDK |
| M00-T15 | Cập nhật ADR 0024/0025/0028 theo spike → Accepted/Revised | meta | | review |

## DoD
- [ ] `git clone --recurse-submodules` + `scripts/bootstrap.sh` → mọi container healthy.
- [ ] Contracts alpha publish (local registry hoặc `bun link`).
- [ ] 6 spike có report + quyết định.
- [ ] ADR 0001–0007 Accepted.

## Acceptance Gate
1. `scripts/lock-verify.sh` PASS; 2. compose up healthy ≤ 5 phút (image nhẹ); 3. S-1 chứng minh build offline; 4. S-2 chứng minh app ↔ databroker trong compose không cần docker.sock; 5. S-5 Sim chạy.
Nếu S-1 hoặc S-2 FAIL ⇒ dừng, viết ADR thay thế trước khi sang M1.

## Rủi ro
R14, R15 (image lớn/mạng) — bắt đầu bake cache sớm; R13 kết quả S-3.

---

## Trạng thái thực hiện (cập nhật 2026-10-01)

Bố cục dev đã đổi theo yêu cầu PO → [ADR-0009](../adr/ADR-0009-dev-phase-module-folders.md) (thư mục module + root `docker-compose.yml`; submodule/lock dời tới release).

| Task | Trạng thái | Ghi chú / bằng chứng |
|---|---|---|
| T01 meta-repo skeleton | ✔ | `README.md`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `.env.example`, `docker-compose.yml`, `scripts/sv`, `docs/` |
| T02 module folders | ✔ (dev form) | 10 thư mục `modules/*`; có code thật: `velocitas-stack`, `ide-vscode`, `simvehicleapp-studio` (snapshot Sim v0.7.13); còn lại placeholder README |
| T03 lock + scripts | ↷ dời | lock/submodule chỉ ở release (ADR-0009); `scripts/sv` thay cho bootstrap trong dev |
| T04 BASELINE | ✔ | `docs/BASELINE.md` (SHA + digest) |
| T05/T06 contracts alpha + fixtures | ☐ | chưa làm — chuyển đầu M1 (không chặn các spike) |
| T07 compose skeleton | ✔ | root include 3 fragment; mỗi fragment `config -q` độc lập |
| T08 CI chung | ☐ | chưa có CI (repo chưa init git) |
| T09 S-1 | ✔ PASS | offline new project: init 26 s / deps 2 s / build 10 s |
| T10 S-2 | ✔ PASS | SampleApp ↔ databroker:55555 ↔ MQTT |
| T11 S-3 | ✔ PASS | set() = actuator **target** only |
| T12 S-4 | ✔ PASS | mock-provider `VDB_ADDRESS` + `/mock/mock.py` |
| T13 S-5 | ✔ PASS (prebuilt) | build từ source: realtime ✔, migrations ✔, studio xem report §8 |
| T14 S-6 | ✔ PASS | clangd 0 errors trong code-server |
| T15 cập nhật ADR | ✔ | 0024/0025/0028 Accepted, 0023 Notes, 0009 mới |
| (thêm) E-1 export → devcontainer | ✔ PASS | `devcontainer up` + build + runtime-local + run app |

**Gate M0:** tiêu chí 3 (S-1 offline) ✔, 4 (S-2 không docker.sock) ✔, 5 (Sim chạy) ✔, 2 (compose up healthy) ✔; tiêu chí 1 (`lock-verify`) thay bằng `docker compose config` theo ADR-0009 ✔. Còn mở: contracts alpha (T05/T06) và CI (T08) — đề xuất làm ngay đầu M1.

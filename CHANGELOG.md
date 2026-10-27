# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/); phiên bản theo SemVer. Chi tiết từng milestone:
[docs/reports/](docs/reports/), trạng thái: [docs/ROADMAP.md](docs/ROADMAP.md).

## [Unreleased]

### Kế hoạch Robotics (M22–M26, chưa code)
- Phân tích + thiết kế mở rộng sang robot: RSS (Robotic Signal Specification), Protobus (RSS ↔ ROS 2), target `python-robot`, block robot, mẫu kịch bản ([design](docs/design/M22-robotics-extension.md); ADR 0064–0068 **Proposed, chờ PO**).

## [baseline-2026-10-27] — 2026-10-27 (baseline, tag local)

Tag annotated `baseline-2026-10-27`, gắn ở máy dev theo yêu cầu PO: commit để baseline, **chưa push nên chưa có CI** cho commit này.
- **Bằng chứng thay cho CI:**
  - `scripts/sv precheck` PASS (các bước repo checks của CI, `diagnostics-guard`, cây fork Sim);
  - ba E2E `@live` PASS trên stack thật lúc quay video: `m21-showcase`, `m15-full-flow` + `@live-restart`, `tutorial-live`;
  - trợ lý dùng LLM thật qua endpoint OpenAI-compatible.
- **Commit gần nhất có CI xanh:** `8c42fd26`.
- **Không có GitHub Release, không có image dựng sẵn mới.**
- **Video:** ba video `docs/media/{showcase,full-flow,demo}.mp4` quay theo nhịp người dùng (con trỏ hiển thị, gõ từng phím), dùng LLM thật.

### M21 — Hoàn tất roadmap ([phase](analysis/phases/M21-roadmap-completion.md))
- **Gọi workflow từ workflow:** block **Call workflow** chạy một workflow hàm (trigger **When called**) tại chỗ; compiler inline lúc compile, cấm gọi vòng, tối đa 4 cấp ([hướng dẫn](docs/user-guide/sub-workflows.md), ADR-0063).
- **Nhiều app qua MQTT** (standalone service): hướng dẫn và gate hai app chạy cùng lúc, mỗi app một databroker ([multiple-apps](docs/user-guide/multiple-apps.md)).
- **KUKSA databroker 0.7.1:** bản vá bảo mật provider của 0.6.1; bỏ API cũ `sdv.databroker.v1`. signal-gateway ghi giá trị actuator qua `kuksa.val.v1`.
- **Deploy lên Eclipse Kanto:** đẩy image xong thì tải được descriptor container-management của kanto-cm.
- **Mở studio và IDE từ máy khác:** profile `remote-ide`. Reverse proxy Caddy cho studio, realtime và code-server cùng một origin; IDE chỉ cho người đã đăng nhập studio ([DEPLOY](docs/DEPLOY.md)).
- **Studio:**
  - gỡ các block LLM của Sim (agent, router, evaluator…);
  - nâng bảo mật next 16.4.2, dompurify, MCP SDK, undici, vite, zod…;
  - Sign up nhận tên tiếng Việt gõ ở dạng tách dấu.
- **Tài liệu:**
  - tutorial sửa bước Run (giá trị hiện tại, tab Flow);
  - cognitive walkthrough thay cho usability test, **chưa test với người thật**.
- **Không làm (có lý do trong ADR):** gRPC (ADR-0043), Quick Run (ADR-0048), `sv_rate` (ADR-0049).

### M20 — App WebAssembly cho C++ và Rust ([báo cáo](docs/reports/M20.md))
- Khi tạo app, chọn **Runtime → WebAssembly** cho C++ hoặc Rust. App chạy trong `sv-wasm-host` (Wasmtime 48), có giới hạn bộ nhớ và thời gian, và allowlist tín hiệu/topic.
- SynCode, test trong guest, Run, Flow, Export, image deploy (khoảng 9 MB) đều như app native. Conformance 52/52 và parity 7/7 cho cả hai ([hướng dẫn](docs/user-guide/wasm.md)).

### M19 — Luồng thực thi (Flow) ([báo cáo](docs/reports/M19.md))
- **Tab Flow** (Simulate, Test, Live), cho mỗi lần chạy:
  - cái gì kích hoạt và đến từ đâu (inject, playback, app, xe);
  - nhánh đã rẽ và giá trị điều kiện;
  - app đã ghi gì.
- **Run console** viết thành câu (công tắc Raw).
- **Test:** case không đạt có giải thích; **Make test case from this run**.

### M18 — Bàn thử nghiệm, workflow dễ đọc v2, Deploy ([báo cáo](docs/reports/M18.md))
- **Tab Test:** test case lưu cùng workflow, Generate tests, độ phủ, Simulate all; trợ lý đề xuất test case.
- **Canvas:** block gọn, Logic view đọc workflow thành câu, Auto layout theo làn, giá trị sống trên cạnh.
- **Deploy:** lên databroker của xe hoặc bench (read-only mặc định); đẩy container image không cần Docker.

### M17 — Dọn bề mặt Sim + runtime xe dùng chung ([báo cáo](docs/reports/M17.md))
- Ẩn bề mặt chạy workflow của Sim.
- Mỗi run một databroker riêng (`SV_RUN_SANDBOX=1`), quota và thời hạn, My runs, chạy song song, Extend.

### M16 — Trải nghiệm & kiểm soát tài nguyên ([báo cáo](docs/reports/M16.md))
- **Vehicle apps:**
  - SynCode tự tạo app cho workflow chưa có app; app sẵn sàng thì SynCode tự chạy.
  - Trang Vehicle apps có giải thích, dung lượng từng app, quota, và các nút Clean / Delete (gõ tên để xác nhận) / Repair.
  - Xoá workspace thì app của nó bị dọn.
- **Kiểm soát dung lượng host (ADR-0053):**
  - Quota app/workspace/host và workflow/app; ngưỡng đĩa (507 `HOST_DISK_LOW`).
  - Mỗi app chỉ có 1 SynCode chờ; hàng đợi có giới hạn (429).
  - Sweeper chạy mỗi giờ; `POST /sweep` để chạy ngay. `scripts/sv apps list|prune`.
  - Gate, smoke và E2E tự xoá app của chúng. DEPLOY có mục "Dung lượng & quota".
- **Editor (ADR-0054):** nút có trạng thái (spinner, ✓/✕), nút chính, chip app, pill trạng thái, gợi ý bằng lời. Ẩn Tables/Files/Knowledge/Logs/Scheduled tasks; Settings chỉ còn phần dùng cho toolchain.
- **Canvas (ADR-0055):** mỗi block xe có câu tóm tắt và nhãn vai trò; cạnh nhánh có nhãn và màu; chip "uses:" làm nổi block nguồn. Graph, IR và code sinh ra không đổi.
- **Sửa lỗi:** SynCode sinh workflow đã xoá; lỗi 409/429/507 bị biến thành 502; `tree` đi theo symlink; backup cũ không bao giờ bị xoá; `sv smoke` để lại thư mục mỗi lần chạy.

## [baseline-2026-10-14] — 2026-10-14 (pre-release)

Tại commit `12e803a` — CI xanh (run 38436298021 toàn bộ @ `89a8eb1`, 38490652578 @ `424d8ff`, 38491940778 @ `12e803a`).
Release: [baseline-2026-10-14](https://github.com/Blinkthor/sim-vehicle-app/releases/tag/baseline-2026-10-14), kèm image dựng sẵn (`scripts/sv pull`).
- Mô hình VSS tuỳ biến `vX.Y-<tên>`: file riêng hoặc overlay, `scripts/sv vss`, databroker-custom, project tự theo model mới (ADR-0052).
- Bộ kịch bản C42–C45 (vượt 60 km/h → HMI + đèn phanh; 3 kịch bản ADAS) + `expect.publishes`: nội dung HMI giống hệt ở 4 runtime.
- Trợ lý AI với model thật: eval 20/20, gate M10 3/3; sửa parser stream tool call song song.
- Triển khai máy yếu: image dựng sẵn qua release, venv Velocitas dùng chung (~200 MB → ~4 MB mỗi project), `SV_BUILD_JOBS` (ADR-0051).
- Độ bền: orchestrator retry khi keep-alive chết, signal-gateway nạp lại signal mới, build C++ cài lại deps khi model đổi.

## [baseline-2026-10-13] — 2026-10-13 (pre-release)

Mốc baseline tại commit `7487f17` — CI [run 38423365394](https://github.com/Blinkthor/sim-vehicle-app/actions/runs/38423365394)
xanh 16/16 job trên runner private 2 vCPU / 7 GB. Release: [baseline-2026-10-13](https://github.com/Blinkthor/sim-vehicle-app/releases/tag/baseline-2026-10-13).
Nội dung = mục 1.0.0-rc.1 bên dưới + M12–M15 (backend Python/Rust, `sv_filter`, `sv_state_machine`, khối composite,
E2E Playwright toàn diện) + CI chọn job theo đường dẫn (`scripts/ci/changes.py`). Không phải v1.0: mục còn mở ở phần "Đã biết".

## [1.0.0-rc.1] — chưa phát hành

Ứng viên v1.0 (MVP = M0→M11). Phát hành thật (tách repo, tag, lock, image) chờ PO xác nhận — `scripts/release-split.sh`.

### Thêm mới
- **Studio** (fork Sim v0.7.13, Apache-2.0): canvas khối xe từ catalog VSS (v4.0, v4.2), 36 khối (trigger, sensor/actuator,
  logic, flow, state, comm), lint realtime + Problems, Simulation (scenario, timeline, replay), Vehicle projects, SynCode
  với Build log và Generated files, Run/Stop trên KUKSA thật, Run console, Signals (inject, record ⇒ scenario), badge trace
  live, Open IDE (code-server), Export zip, nhập lại workflow, trợ lý AI (đề xuất WorkflowPatch hiển thị dạng diff, xác
  nhận hành động), System status.
- **Core:** VSS catalog, compiler tất định Graph → IR (diagnostics công khai, kiểu/đơn vị), simulator (P2).
- **compiler-code-cpp:** generator C++ tất định + runtime (ngữ nghĩa ADR-0012), test sinh từ scenario, conformance P1.
- **Orchestrator:** workspace (ghi atomic, export tất định), pipeline SynCode, RunManager + TraceIngest, signal-gateway
  (kuksa.val.v1, scenario player), EntitlementService (license Ed25519 `full`/`enforce`), `/metrics`, `/system`.
- **AI (`simvehicleapp-ai`):** provider anthropic/openai/openai-compatible/ollama/gemini/`fake`, 13 tool, MCP server/client,
  store `sv_ai`, cổng license `ai.assistant`.
- **Vận hành:** Docker Compose (cổng chỉ 127.0.0.1), `scripts/sv`, `scripts/bootstrap.sh`, refresh từ CI, parity P3,
  benchmark NFR-02, osv-scanner + license scan trong CI.

### Đã biết / chờ quyết định
- Eval trợ lý AI ≥ 80 % chưa đạt ổn định trên model local 9B (65–80 %) — đo lại với provider cloud.
- Dọn Sim đợt 3b (block AI lõi, hạ tầng OAuth tích hợp, nâng dependency lõi có lỗ hổng) — ADR-0008 Notes.
- Usability test 5 người (M11-T09) cần người tham gia thật.

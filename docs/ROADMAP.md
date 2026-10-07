# ROADMAP.md — Theo dõi tiến độ SimVehicleApp (nguồn: 34 ADR + `analysis/phases/*`)

> File này là **bảng tracking sống** (cập nhật liên tục khi code), khác với [`analysis/13-implementation-roadmap.md`](../analysis/13-implementation-roadmap.md) (kế hoạch tổng, ít đổi) và `analysis/phases/M<nn>-*.md` (chi tiết task/DoD/Gate từng milestone, ít đổi). Khi một **feature** dưới đây hoàn thành thật (có test/bằng chứng, không phải "nghĩ là xong"), đổi trạng thái ngay trong PR đóng task đó.
>
> Sinh ngày 2026-10-02 từ: 34 ADR (`analysis/adr/ADR-0001`…`0042`) + 15 file `analysis/phases/M00`…`M14`. Mỗi dòng feature = 1 cụm task (ID task gốc ghi trong cột cuối) để không phải tick 150+ ô task rời.

## 1. Vòng đời cập nhật file này (bắt buộc)

1. Bắt đầu làm 1 feature → đổi `☐` thành `🔄`, ghi tên người/agent + ngày bắt đầu vào cột Ghi chú.
2. Thực hiện đúng skill `simvehicleapp-phase-execution`: đọc ADR liên quan → research upstream nếu cần → viết test trước → implement → nếu phát hiện ADR/doc sai thì xử lý mismatch (sửa ADR/doc) **trước khi** tiếp tục code, không âm thầm lệch.
3. Chỉ đổi `🔄` thành `✔` khi: test thật pass (unit/golden/contract tương ứng) **và** Definition of Done của milestone (trong `phases/M<nn>-*.md`) cho phần đó đã đạt. Ghi bằng chứng (commit SHA ngắn, hoặc link PR, hoặc file report) + ngày vào cột Ghi chú.
4. Khi **toàn bộ** feature của 1 milestone đã `✔` → chạy Acceptance Gate của milestone đó → viết `docs/reports/M<nn>.md` theo `analysis/phases/REPORT_TEMPLATE.md` → cập nhật dòng tổng quan ở §3 → **chỉ sau đó** milestone kế tiếp mới được bắt đầu (luật cứng AGENTS.md §2 #7, không bỏ qua gate).
5. Một feature không được `✔` nếu ADR nguồn của nó còn `Proposed` khi milestone yêu cầu `Accepted` (xem cột ADR ở §3 và `analysis/adr/README.md` §2) — trừ khi milestone đó tự làm công việc Accept (ví dụ M0 với spike).
6. Mục M14 (backlog) **không** tick `✔` khi chưa có ADR riêng cho hạng mục đó — đúng quy tắc "mỗi mục cần ADR riêng trước khi làm" trong `phases/M14-*.md`.

## 2. Quy ước trạng thái

| Ký hiệu | Nghĩa |
|---|---|
| ☐ | Chưa bắt đầu |
| 🔄 | Đang làm |
| ✔ | Xong — có test/bằng chứng thật |
| ✘ | Blocked / FAIL — ghi rõ lý do, không được coi milestone xong |
| ↷ | Dời sang milestone/giai đoạn khác (ghi rõ lý do + ADR) |

## 3. Tổng quan milestone (đường găng: M0→M1→M2→M3→M4→M6→M7→M8→M11; chi tiết song song hoá ở [13 §1](../analysis/13-implementation-roadmap.md#1-đồ-thị-phụ-thuộc))

| M | Tên | ADR cần Accepted | Trạng thái tổng | Tiến độ |
|---|---|---|---|---|
| [M0](#m0--foundations) | Foundations | 0001–0007, 0009 | ✔ | 8/9 ✔; 1 ↷ — gate PASS 2026-10-03 ([report](reports/M00.md)) |
| [M1](#m1--studio-shell) | Studio shell | 0003, 0004, 0008 | ✔ | 12/12 ✔ — gate PASS 2026-10-04 ([report](reports/M01.md)) |
| [M2](#m2--vss-catalog--vehicle-blocks) | VSS & vehicle blocks | 0010, 0011 | ✔ | 12/12 |
| [M3](#m3--logicflowstatecomm-blocks) | Logic/Flow blocks | 0012, 0013, 0018 | ✔ | 14/14 — gate PASS 2026-10-06 ([report](reports/M03.md); review conformance theo uỷ quyền PO, chờ xác nhận) |
| [M4](#m4--compiler--ir) | Compiler & IR | 0014, 0015, 0016, 0018 | ✔ | 12/12 — gate PASS 2026-10-07 ([report](reports/M04.md); ADR-0014/0015 + review golden IR theo uỷ quyền PO, chờ xác nhận) |
| [M5](#m5--simulator) | Simulator | 0017 | ✔ | 10/11 + T08 ↷ — gate PASS ([report](reports/M05.md)) |
| [M6](#m6--c-backend--runtime) | C++ backend | 0020, 0021, 0022 | ✔ | 20/20 — gate PASS ([report](reports/M06.md)) |
| [M7](#m7--workspacetoolchainsyncode) | SynCode E2E | 0023, 0025, 0026 | ✔ | 19/19 — gate PASS ([M07](reports/M07.md)) |
| [M8](#m8--live-run--observability) | Live Run | 0024, 0027 | ✔ | 10/10 — gate PASS 2026-10-07 ([report](reports/M08.md); ADR-0027 Notes theo uỷ quyền PO, chờ xác nhận) |
| [M9](#m9--ide--export--license) | IDE & Export | 0028, 0031 | ✔ | 8/8 — gate PASS 2026-10-07 ([report](reports/M09.md); Notes theo uỷ quyền PO, chờ xác nhận) |
| [M10](#m10--ai-assistant--mcp) | AI & MCP | 0030 | ✔ | 10/10 — gate PASS 2026-10-07 với eval LLM thật **BYPASS** (quyết định PO, chờ API key); MCP + 13 tool 36/36 ([report](reports/M10.md)) |
| [M11](#m11--hardening--release-v10) | Hardening → v1.0 | 0032, 0033, 0042 | 🔄 | 3/10 ✔, 2 🔄 — tiếp tục theo uỷ quyền PO dù gate M10 còn chờ eval với provider cloud |
| [M12](#m12--python-backend) | Python backend | 0040 | ✔ | 6/6 — gate PASS về chức năng 2026-10-07 (parity P3 Python 7/7 trên KUKSA, lệch ≤ 3 ms); R10 lệch có chủ đích (ADR-0040 Notes §8) theo uỷ quyền PO — chờ PO xác nhận ([report](reports/M12.md)) |
| [M13](#m13--rust-backend-feasibility) | Rust feasibility | 0041 | 🔄 | bắt đầu 2026-10-07 (Claude Code) |
| [M14](#m14--mở-rộng-sau-v10-backlog) | Mở rộng (backlog) | 0043–0048 (chưa viết) | ☐ | 0/10 |
| [M15](#m15--e2e-toàn-diện--video-demo-bước-cuối) | E2E toàn diện + video demo (bước cuối) | — | ☐ | 0/12 |

**MVP v1.0 = M0→M11, 147 dòng feature** (gồm 1 dòng M0 dời sang release M11-T10, không tính là hoàn thành). Đã có bằng chứng cho 8/147 dòng (~5%) — phần hạ tầng/spike của M0 và `simvehicleapp-contracts` 1.0.0-alpha.1; **chưa có dòng code sản phẩm thật nào** ở các module `simvehicleapp-core/orchestrator/ai` (còn placeholder README). `modules/simvehicleapp-studio` hiện là **snapshot gốc** của Sim v0.7.13 chưa refactor — M1 là nơi bắt đầu cắt gọt.

---

## M0 — Foundations
ADR: [0001](../analysis/adr/ADR-0001-record-architecture-decisions.md)–[0007](../analysis/adr/ADR-0007-service-decomposition-and-contracts.md), [0009](../analysis/adr/ADR-0009-dev-phase-module-folders.md) · Chi tiết: [phases/M00](../analysis/phases/M00-foundations.md)

| Feature | ADR | Trạng thái | Ghi chú (bằng chứng) | Task |
|---|---|---|---|---|
| Meta-repo skeleton (README/AGENTS/CLAUDE/.gitignore/docs/scripts) | 0001,0009 | ✔ | Push `github.com/ltnguyenlt2k/simvehicleapp` 2026-10-02 | T01 |
| Module folders dev-phase | 0009 | ✔ (dạng dev) | 10 thư mục `modules/*`; code thật: `velocitas-stack`, `ide-vscode`, `simvehicleapp-studio` (snapshot), `simvehicleapp-contracts` (alpha, 2026-10-03); còn lại placeholder | T02 |
| Lock + `scripts/modules.sh` quản lý submodule | 0002 | ↷ | Dời tới release theo ADR-0009; dev dùng `scripts/sv` | T03 |
| `docs/BASELINE.md` (SHA/digest pin) | 0003 | ✔ | File có đủ SHA Sim/template/SDK + digest image | T04 |
| Contracts v1-alpha (schema workflow-graph/ir/diagnostics/block-spec/…) + fixtures | 0007 | ✔ | Claude Code 2026-10-03. `@simvehicleapp/contracts@1.0.0-alpha.1`: 17 JSON Schema + catalog 50 mã, OpenAPI 3.1 cho 8 service (validate theo meta-schema OAS 3.1), TS types sinh tự động + validator Ajv, `@simvehicleapp/service-kit`; fixture VSS 4.0 + units.yaml (pin `249dc03`), GW-A `graph.json`/`scenario.yaml`. `bun test` 89/89 PASS, `bun run check` PASS, publish `bun link` kiểm từ consumer. commits `8d11a9a` `4a7600d` `07d8d90` `faa2878` `f35ff2a` `48da339` `598d470`. Lưu ý: ADR-0007 vẫn Proposed — Accept là việc của gate M0; AsyncAPI/Python types dời M8/M12 (ngoài phạm vi T05) | T05–T06 |
| Compose skeleton root (`docker-compose.yml` include 3 fragment) | 0005,0009 | ✔ | `scripts/sv` + `docker-compose.yml` | T07 |
| CI chung (license scan, contract-only-deps, compose lint) | 0004,0005 | ✔ | Claude Code 2026-10-03: `scripts/ci/*`, `scripts/license/*`, `.github/workflows/ci.yml` (commits `9aeafad` `4fbd803`). **Local PASS** 2026-10-03: self-test 19/19 (mỗi luật có case vi phạm bị từ chối), compose-lint/contract-only-deps/license-scan PASS, contracts check+test 89/89. **GitHub Actions PASS** 2026-10-03 run #1 [37115615196](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37115615196) @ `4f39bae` (5/5 job). **Còn (không chặn ✔):** PO xác nhận ngoại lệ `argparse@2.0.1` (Python-2.0, dev-only) trong `scripts/license/license-exceptions.txt` | T08 |
| Spike S-1..S-6 + E-1 (toolchain offline, databroker+MQTT, `set()` semantics, mock-provider, Sim minimal, code-server clangd, devcontainer export) | 0006,0024,0025,0028 | ✔ PASS cả 7 | `docs/spikes/M0-spikes-report.md` | T09–T14 |
| Cập nhật ADR theo kết quả spike | 0023,0024,0025,0028 | ✔ | 0024/0025/0028 Accepted, 0023 có Notes, 0009 ra đời | T15 |

**M0 gate PASS (2026-10-03)** — bằng chứng từng tiêu chí: [`docs/reports/M00.md`](reports/M00.md) (stack up 19,7 s + smoke OK, CI run 37115615196, contracts 89/89, ADR 0001–0007/0009 Accepted). **M1 được phép bắt đầu**; lưu ý build studio từ source cần máy/CI ≥ 16 GB RAM trước M1-T02c.

## M1 — Studio shell
ADR: [0003](../analysis/adr/ADR-0003-upstream-baseline-and-fork-policy.md), [0004](../analysis/adr/ADR-0004-license-compliance.md), [0008](../analysis/adr/ADR-0008-sim-refactor-strategy.md) · Phụ thuộc: M0 · Chi tiết: [phases/M01](../analysis/phases/M01-studio-shell.md)

| Feature | ADR | Trạng thái | Ghi chú | Task |
|---|---|---|---|---|
| Fork + tag `baseline-v0.7.13` + `UPSTREAM_SYNC.md` | 0003 | ✔ | Claude Code 2026-10-03: dev một repo (ADR-0009) ⇒ tag `studio/baseline-v0.7.13` @ `68f7f9a`; "merge-base check" = `scripts/upstream_tree_check.py` so tree với `ad0b867`: 12.226/12.226 file giống từng byte, thay đổi cục bộ phải khai báo trong `UPSTREAM_SYNC.allow` → PASS; CI job `vendored-trees` (commits `4a9418d` `ac0f165` `1cec4e2`). Phát hiện kèm: import mất bit thực thi + template C++ thiếu `build.sh` (đã khôi phục) | T01 |
| Clean-room gỡ `ee/` (spec Apache + `lib/sv/oss/*` + codemod + xoá `apps/sim/ee/`) | 0004 | ✔ | Claude Code 2026-10-03. **T02a** spec [docs/specs/M01-T02a-oss-clean-room-spec.md](specs/M01-T02a-oss-clean-room-spec.md) — PO ký clean-room 2026-10-04. **T02b ✔** `lib/sv/oss/*` + 15 contract test (`5af31ae`). **T02c ✔** xoá `apps/sim/ee`, codemod 70 file (`a06dee1`): CI run [37123511051](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37123511051) 9/9 PASS — studio tsc + 9.356 test, `studio-guards`, **image build từ source** (`studio-image`); image đó chạy local: title "Log In \| SimVehicleApp", `--brand-accent:#0FC0FF`, không còn `sim.ai` ở /login, `/sso` → /login | T02a–c |
| Gỡ copilot (`lib/copilot/**`, routes, panel placeholder) | 0004 | ✔ | Claude Code 2026-10-03 (`0224245` `760f434`): copilot thực tế là cả Chat/Mothership ⇒ gỡ 494 file (service layer, routes, Chat home, scheduled tasks, inbox, settings Chat keys/Sim mailer/Mothership); panel → "Assistant — Coming in M10"; giữ 45 helper cục bộ không gọi mạng (khai báo `UPSTREAM_SYNC.allow`, ghi ở analysis/11). Không còn `copilot.sim.ai`/`SIM_AGENT_API_URL` (guard CI). tsc 0, vitest 571/8.451, CI [37126936973](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37126936973) 9/9 gồm image từ source | T03 |
| Gỡ `apps/pii`, `apps/docs`, devcontainer/helm cũ, Trigger.dev | 0008 | ✔ | Claude Code 2026-10-03 (`6716e5e`): xoá pii/docs/.devcontainer/helm/compose cũ (1.677 file), `bun.lock` cập nhật bằng bun 1.3.13 (chỉ hoisting). Trigger.dev: xác minh luồng còn giữ chạy backend `database` khi `TRIGGER_DEV_ENABLED` tắt (analysis/11 §57), giữ SDK tới M11. Build: CI [37127484709](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37127484709) 9/9 gồm image từ source | T04 |
| Toolbar allowlist `sv_*` (ẩn 268 block cũ) | 0008 | ✔ | Claude Code 2026-10-03 (`5378173`): `NEXT_PUBLIC_SV_TOOLBAR_ALLOWLIST` (tiền tố NEXT_PUBLIC_ vì chạy client; mặc định `sv_*,note`) trong `filterBlocks`; test với registry thật: chỉ còn `note`; route integrations/skills/upgrade + trang marketing redirect. CI [37127484709](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37127484709) PASS. E2E Playwright: toolbar chỉ có `Note`, không Agent/Slack/Loop — CI [37143014979](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37143014979) | T05 |
| Rebrand (brand.ts, metadata, NOTICE) | 0003 | ✔ | Claude Code 2026-10-03, **làm trước thứ tự theo yêu cầu PO**. Xong: brand kit từ bảng logo PO + thay 60 logo/favicon/icon Sim tại chỗ + NOTICE (commits `7847389` `2206638`; build tất định). Tên/metadata/màu qua `lib/sv/oss/brand` đã kiểm trên image build từ source (2026-10-03). T06 tiếp (`92cf84b`): 0 chuỗi "Sim Studio" trong source, email ký "The SimVehicleApp team", footer bỏ link Sim, docs link từ brand. Visual: PO xác nhận logo trên trình duyệt; E2E kiểm title SimVehicleApp — CI [37143014979](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37143014979). `docsLink` sim.ai trong block Sim đã ẩn xoá ở M11 | T06 |
| Tắt telemetry mặc định | 0004 | ✔ | Claude Code 2026-10-03 (`0c00217`): bỏ collector mặc định `telemetry.simstudio.ai` (server OTel + relay `/api/telemetry`) — chỉ gửi khi cấu hình `TELEMETRY_ENDPOINT`/`OTEL_EXPORTER_OTLP_ENDPOINT`; test relay không gọi `fetch` khi không có endpoint; GTM/GA/Profound chặn bởi `isHosted`, PostHog cần cờ + key. CI [37128081909](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37128081909) 9/9 | T07 |
| Dockerfiles compose meta (app/realtime/migrations) | 0005 | ✔ | 2026-10-03: dùng Dockerfile upstream `docker/{app,realtime,db}.Dockerfile` (migrations = `db.Dockerfile`), fragment `compose.simvehicleapp.yaml` build từ module. Bằng chứng compose up với image build từ source: realtime/migrations build local, app build CI (artifact run 37123511051) → `up --wait` healthy, migrations exit 0, title SimVehicleApp | T08 |
| BFF skeleton `/api/sv/health` | 0007 | ✔ | Claude Code 2026-10-03 (`98079c8`): `lib/sv/api-client` (`SV_*_URL`, `x-sv-internal`, `x-sv-request-id`, timeout 2 s), route qua `svHealthContract`, cần session; 7 test; `check:api-validation` PASS (thêm vào CI). CI [37128686717](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37128686717) 9/9 | T09 |
| Layout editor: action bar + bottom dock + banner an toàn | 0008 | ✔ | Claude Code 2026-10-03 (`a3217a1`): `components/sv` — action bar 7 nút disabled (ghi milestone), dock 5 tab rỗng thay terminal executor (ADR-0006), banner NFR-10; DOM test 3. ARIA snapshot Playwright (banner, 7 action disabled, 5 tab dock) PASS trên image build từ source — CI [37143014979](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37143014979) | T10 |
| Scratch opcode denylist + `ee/` path guard trong CI | 0004 | ✔ | Claude Code 2026-10-03: `scripts/ci/scratch_denylist.py` + `analysis/adr/scratch-opcode-denylist.grep` (khớp nguyên literal trong code SimVehicleApp), `studio_guards.py` (`ee/`, `@/ee/`, copilot service); self-test có case vi phạm. CI [37128686717](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37128686717) | T11 |
| i18n check (Q8) | — | ✔ | 2026-10-03 [docs/reports/M01-T12-i18n.md](reports/M01-T12-i18n.md): Sim không có i18n UI ⇒ EN mặc định; tiếng Việt cần ADR riêng | T12 |

## M2 — VSS catalog & vehicle blocks
ADR: [0010](../analysis/adr/ADR-0010-vss-catalog.md), [0011](../analysis/adr/ADR-0011-block-model-on-canvas.md) · Phụ thuộc: M1 · Chi tiết: [phases/M02](../analysis/phases/M02-vss-catalog-and-vehicle-blocks.md)

| Feature | ADR | Trạng thái | Ghi chú | Task |
|---|---|---|---|---|
| `packages/vss` (parse/classify/normalize/hash) | 0010 | ✔ | 2026-10-04: `modules/simvehicleapp-core/packages/vss`; `bun test` 54/54 (24 path biết trước, counts 287/425/379/106 v4.0 + 322/484/467/118 v4.2, `deprecation` thật v4.2, mọi node khớp `VssNode` OpenAPI, hash canonical khớp bản Python độc lập), `tsc` 0 lỗi; CI job `core` | T01 |
| VSS sources (LocalFile seed v4.0/v4.2 + Http cache pin tag) | 0010 | ✔ | 2026-10-04: `packages/vss/src/sources.ts` (`LocalFileSource`, `HttpSource` chỉ tải release có pin sha256 + cache `sv-vss` ghi nguyên tử, `CompositeSource`); fixture v4.2 vendor ở contracts; 13 test offline (fetch inject) PASS | T02 | T02 |
| Search index (fuzzy, filter kind) | 0010 | ✔ | 2026-10-04: `packages/vss/src/search.ts` — token camelCase trên name/path/description, prefix + fuzzy 1 lỗi, lọc kind, thứ tự tất định; "state of charge" top-5 chứa `…StateOfCharge.Current` (v4.0 & v4.2); 17 test PASS | T03 | T03 |
| Service `vss-catalog` + ETag + OpenAPI | 0010 | ✔ | 2026-10-04: `:4010` nội bộ; `services/vss-catalog` + image (seed v4.0/v4.2, contracts qua `docker-image://`); 29 contract test (mọi response validate theo OpenAPI, ETag/304, lỗi 400/404/503, auth) PASS; container healthy + smoke local; CI job `core-image` | T04 |
| BlockSpec 4 block vehicle (`sv_read_signal/read_attribute/set_actuator/on_signal_changed`) | 0011 | ✔ | 2026-10-04: `packages/blocks/<type>/{spec.json, semantics.md}`; 23 test (validate `block-spec.v1`, handle theo canvas Sim, mã diagnostic có trong catalog, `vssKinds` ≡ `blocksFor` trên mọi node v4.0/v4.2) PASS; Notes ADR-0011 | T05 | T05 |
| `GET /blocks` skeleton (compiler service) | 0011 | ✔ | 2026-10-04: `services/compiler` `:4020` nội bộ; `/blocks` validate theo OpenAPI + ETag/304; route M4/M5 trả 501; 4 test PASS; image healthy + smoke trong CI job `core-image` | T06 | T06 |
| SubBlock `vss-path-selector` | 0011 | ✔ | 2026-10-04: `components/sv/vss/` — cây lazy (`/tree` từng cấp) + tìm kiếm debounce, leaf sai kind hiện nhưng bị khoá kèm lý do, path đã chọn hiển thị dạng card read-only + "Change" (Notes ADR-0011), badge kind/type/unit/`[ ]`/deprecated; `SubBlockType` + `SubBlockConfig.vssKinds/vssWrites` (`// SV:`); 13 test component PASS, tsc 0 lỗi, audit API/React Query PASS | T07 | T07 |
| SubBlock `sv-typed-value`, `sv-enum` | 0011,0018 | ✔ | 2026-10-04: 12 kiểu vô hướng, kiểm phạm vi số nguyên bằng BigInt, int64/uint64 lưu chuỗi thập phân, `min/max/allowed` của catalog, boolean/`allowed` chỉ chọn, mảng read-only; kiểu lấy từ subBlock `path` (`$signal`) hoặc cố định; 25 test PASS | T08 |
| BlockConfig UI 4 block vehicle + đăng ký | 0011 | ✔ | 2026-10-04: `apps/sim/blocks/vehicle/*` + 1 điểm đăng ký `// SV:`; `block-parity.test.ts` 25 test PASS (đã thử làm lệch ⇒ FAIL) trên snapshot `block-specs.json` giữ bằng `scripts/ci/block_specs_sync.py`; test registry Sim 970 PASS, tsc 0 lỗi | T09 |
| Panel Vehicle (toolbar cây VSS + drag→menu) | 0011 | ✔ | 2026-10-04: section "Vehicle" + menu thả signal theo kind qua đường tạo block của Sim; Playwright `m2-gate.spec.ts` (kéo Speed → Read, không có Set; đổi release v4.2) PASS trên CI run 37180539123 | T10 |
| Project settings chọn VSS release | 0010 | ✔ | 2026-10-04: bảng `sv_workflow_settings` (migration 0250) + `GET/PUT /api/sv/workflows/[id]/settings` (quyền workflow, khoá ⇒ 423, release phải có trong catalog) + chọn release ở đầu panel Vehicle; 5 test route PASS; Notes ADR-0010 | T11 | T11 |
| BFF proxy `/api/sv/catalog/*` | 0007 | ✔ | 2026-10-04: route `releases/tree/search/nodes` (session bắt buộc, contract Zod, 400/404 giữ nguyên, lỗi upstream → 502, chưa cấu hình → 503) + hooks `hooks/queries/sv-catalog.ts`; 13 test PASS. Làm trước T07 vì selector cần đường dữ liệu | T12 | T12 |

## M3 — Logic/Flow/State/Comm blocks
ADR: [0012](../analysis/adr/ADR-0012-execution-semantics.md), [0013](../analysis/adr/ADR-0013-dataflow-and-expression-language.md), [0018](../analysis/adr/ADR-0018-vss-array-and-full-datatype-coverage.md) · Phụ thuộc: M2 · Chi tiết: [phases/M03](../analysis/phases/M03-logic-flow-blocks.md)

| Feature | ADR | Trạng thái | Ghi chú | Task |
|---|---|---|---|---|
| `packages/expr` (lexer + Pratt parser + AST) | 0013 | ✔ | 2026-10-04: `core/packages/expr`; 222 test (≥200 ca hợp lệ/lỗi + 2 000 AST ngẫu nhiên round-trip); fuzz 10 phút PASS (34,1 triệu input, seed 7), CI fuzz 30 s; fuzz/test bắt và sửa: tra hàm qua prototype (`constructor(…)`), span lỗi vượt nguồn | T01 |
| Reference `<…>` + resolver interface | 0013 | ✔ | 2026-10-04: `collectRefs`/`checkRefs` + `RefResolver` (block, `<Vehicle.…>`, `<variable.…>` theo Sim, `<loop/parallel.…>`), `EXPR_UNKNOWN_REF` kèm reason; 12 test | T02 |
| Template string `"…{<ref>}…"` | 0013 | ✔ | 2026-10-04: trong parser (đệ quy, `\{` `\}`, span tuyệt đối); có trong bảng test T01 | T03 |
| BlockSpec Logic & Math (14 block, gồm `sv_array_length/at/contains` ADR-0018) | 0013,0018 | ✔ | 2026-10-04: 13 block logic/math/mảng + 4 trigger (`sv_on_app_start/timer/mqtt/condition`) — `spec.json` + `semantics.md`; block thuần dùng opcode `expr` (gộp vào biểu thức), `sv_in_range` giữ `logic.in_range` (có state) | T04 |
| BlockSpec Flow Control (9 block, dùng subflow container Sim cho `sv_repeat/while/parallel`) | 0012 | ✔ | 2026-10-04: 9 block; handle nhánh `then/else`, `case`/`default`, `ok/timeout`, `stable/broken`; container dùng id handle subflow Sim (`loop-/parallel-start/end-source`); `sv_throttle` (P2) chưa làm | T05 |
| BlockSpec State/Comm (5 block) | 0012 | ✔ | 2026-10-04: `sv_var_get/set`, `sv_counter`, `sv_log`, `sv_mqtt_publish`, `sv_hmi_notify` (desugar → mqtt_publish); 36 spec tổng, core 570 test PASS; UI ở T07 (`PENDING_UI` trong parity) | T06 |
| UI BlockConfig + handles (`then/else`, `ok/timeout`,…) | 0011 | ✔ | 2026-10-04: 29 block dựng từ snapshot BlockSpec (`blocks/vehicle/factory.ts`), handle nhánh trên canvas (`svHandles`); block-parity 33 block; E2E `m3-blocks.spec.ts` PASS (CI run 37194043484) — E2E bắt lỗi dropdown đơn vị bị đóng khi đang nhập, đã sửa | T07 |
| SubBlock `sv-expression` (bộ editor Sim: simple-code-editor + prism + TagDropdown, ADR-0013 §4 sửa 2026-10-04) + `sv-duration` | 0013 | ✔ | 2026-10-04: `components/sv/expr/` — editor SVX (highlight, `<` → TagDropdown, chèn signal VSS, chọn nhanh giá trị boolean/allowed), `sv-duration` (ms/s/min, số học thập phân chính xác); Set/debounce của M2 chuyển sang editor thật; studio 8 591/8 591 test PASS (local) | T08 |
| Panel Variables | 0012 | ✔ | 2026-10-04: tái dùng panel Variables của Sim; `sv_var_get/set`, `sv_counter` chọn tên qua dropdown biến của workflow; ánh xạ kiểu ở Notes ADR-0012 | T09 |
| Map subflow `parallel`/`loop` Sim → `sv_parallel/sv_repeat/sv_while` | 0011,0012 | ✔ | 2026-10-04: container `loop`/`parallel` của Sim mang `sv_repeat`/`sv_while`/`sv_parallel` (`lib/sv/container-mapping.ts`, test); mode không hỗ trợ bị ẩn → `CONTAINER_INVALID`; toolbar có Loop/Parallel | T10 |
| `POST /lint` realtime (S0–S3 + một phần S6) | 0016 | ✔ | 2026-10-04: core `packages/compiler` lint (S0–S3 + S6 phần, mã từ catalog, 54 test gồm 45 graph corpus sạch + "cố ý sai"), compiler `POST /lint` qua vss-catalog (smoke CI), studio graph adapter + BFF + debounce 300 ms + tab Problems + badge; E2E: gate M2 dựng trên canvas ⇒ "No problems", block chưa nối ⇒ badge + BLOCK_UNREACHABLE. E2E bắt lỗi adapter đọc giá trị subBlock cũ — đã sửa | T11 |
| Conformance scenarios ≥30 cho ADR-0012 | 0012 | ✔ | 2026-10-04: 38 ca `contracts/fixtures/conformance/C01…C38` + test nhất quán (schema, ref, VSS, thứ tự thời gian); chốt các điểm ngữ nghĩa ở Notes ADR-0012 | T12 |
| 7 golden workflow dựng trên canvas | — | ✔ | 2026-10-06 (Claude Code): `e2e/tests/m3-goldens.spec.ts` dựng GW-A…GW-G qua UI ⇒ Problems sạch ⇒ graph adapter = `graph.json`; `sim-state.json` xuất từ UI (tất định: 2 lần local + CI cùng byte). CI [37491763915](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37491763915) 11/11, E2E 15/15 lần đầu. Lỗi thật tìm ra: auto-connect handle `source`, block Start Sim, drop lệch con trỏ (upstream), login 429, C08 — xem report M03 | T13 |
| Clean-room review checklist | 0004 | ✔ | 2026-10-04: `docs/reviews/M03-clean-room-checklist.md` — 7 mục có bằng chứng, PO ký 2026-10-04 | T14 |

## M4 — Compiler & IR
ADR: [0014](../analysis/adr/ADR-0014-ir-v1.md), [0015](../analysis/adr/ADR-0015-type-and-unit-system.md), [0016](../analysis/adr/ADR-0016-diagnostics-catalog.md), [0018](../analysis/adr/ADR-0018-vss-array-and-full-datatype-coverage.md) · Phụ thuộc: M3 · Chi tiết: [phases/M04](../analysis/phases/M04-compiler-ir.md)

| Feature | ADR | Trạng thái | Ghi chú | Task |
|---|---|---|---|---|
| `graph-adapter.ts` (Sim state → WorkflowGraph v1) | 0014 | ✔ | 2026-10-06 (Claude Code): `lib/sv/graph-adapter.golden.test.ts` — 7 `sim-state.json` dựng qua UI ⇒ đúng `graph.json` + tất định; bản sao golden giữ đồng bộ bởi `scripts/ci/golden_sync.py` (CI). CI [37495196042](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37495196042) 11/11 (studio 8 790 test, golden-sync PASS) | T01 |
| `packages/types` + `packages/units` | 0015 | ✔ | 2026-10-06 (Claude Code): `types` — miền giá trị số nguyên (không tràn lúc chạy), `/` `%` ⇒ double, quy tắc gán/so sánh/hàm/thời gian (ADR-0015 Notes §7), 140 ca; `units` — 61 unit VSS hệ số hữu tỉ chính xác, khớp quantity VSS v4.2, mọi unit signal v4.0/v4.2, >100 cặp khứ hồi chính xác, (scale, offset) làm tròn một lần (Notes §8), 47 test; core PASS, CI [37495196042](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37495196042) 11/11 | T02 |
| S0 parse/limits, S1 structural, S2 block config+migration | 0014 | ✔ | 2026-10-06 (Claude Code): S0–S2 có sẵn từ lint M3 (mỗi mã có test cố ý sai); thêm `EDGE_FANOUT_NOT_ALLOWED` (catalog additive, ADR-0014 Notes; `parallel-start-source` được phép) và khung migration `blockVersion` chạy trước mọi stage (`migrations.ts`, `BLOCK_VERSION_UNSUPPORTED` reason newer/no_path). CI [37495196042](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37495196042) 11/11. Chặn nối fan-out ngay trên canvas: M15-T04 | T03 |
| S3 vehicle model (qua `VehicleModelProvider`) | 0010,0014 | ✔ | 2026-10-06 (Claude Code): provider = `VehicleLookup` (vss-catalog `/nodes`, batch 2 000, có từ M3) + `ModelHashLookup` (`/model-hash`); graph ghim `vss.modelHash` khác hash catalog ⇒ `MODEL_HASH_MISMATCH` (warning, rủi ro R2); test compiler + service. Follow-up: studio ghim hash khi chọn release (cột `sv_workflow_settings`, cần migration); CI [37504105376](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37504105376) 11/11 (E2E 16/16 lần đầu) | T04 |
| S4 types + S5 units (chèn `unit.convert`) | 0015 | ✔ | 2026-10-06 (Claude Code): `compiler/src/typer.ts` — gắn kiểu + unit cho AST SVX và hạ thành `$expr` IR; mỗi op mang `type`/`unit` (backend không suy lại); `unit.convert` mang scale/offset chính xác; literal nhận kiểu đích; mã TYPE_*/UNIT_*/ARRAY_*/VALUE_OUT_OF_RANGE; 28 test (test bắt lỗi literal boolean/chuỗi bị ép thành NaN khi gán). Còn: nối typer vào pipeline compile theo prop BlockSpec (cùng T08); CI [37504105376](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37504105376) 11/11 (E2E 16/16 lần đầu) | T05 |
| S6 control flow (cycle/dominator/reachability/loop guard) | 0012,0014 | ✔ | 2026-10-06 (Claude Code): `controlflow.ts` — SCC Tarjan (`CONTROL_FLOW_CYCLE`), dominator Cooper–Harvey–Kennedy với gốc ảo nối mọi trigger (`DATA_REF_NOT_DOMINATING` cho biểu thức và template; body container không dominate bước sau — While 0 vòng, join any), reachability dùng chung; edge vượt ranh giới container ⇒ `CONTAINER_INVALID` (crosses_boundary); loop guard/parallel có từ M3. Chạy cả trong lint realtime. Compiler 94 test, corpus golden/conformance vẫn sạch; CI [37504105376](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37504105376) 11/11 (E2E 16/16 lần đầu) | T06 |
| S7 backend capability | 0020 | ✔ | 2026-10-06 (Claude Code): `capabilities.ts` — `checkBackend` (semver `irVersions`, opcode trigger/node, `concurrencyPolicies`; một chẩn đoán mỗi block), `httpCapabilities` (cache TTL theo backend, lỗi không cache); stub backend hợp lệ theo contract; 6 test. Op `$expr` thuộc `irVersion` (ADR-0014 Notes §9); CI [37504105376](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37504105376) 11/11 (E2E 16/16 lần đầu) | T07 |
| IR builder + canonicalize + `irHash` | 0014,0018 | ✔ | 2026-10-06 (Claude Code): `compile.ts` — DFS id từ trigger, bảng signals/topics/state, inline block thuần chỉ khi bất biến trong run (ngược lại `logic.eval`), hmi ⇒ mqtt JSON (`json.string`), `type.cast`, stable_for mặc định, concurrency tường minh, canonical JSON + `irHash`, validate `ir.v1`; 45 graph (7 golden + 38 conformance) build IR hợp lệ, tất định 2 lần; golden `ir.json` GW-A…G + review [M04-golden-ir-review](reviews/M04-golden-ir-review.md) (uỷ quyền PO). Tìm ra: 14 conformance sai kiểu (đã sửa, kỳ vọng giữ nguyên), `min/max/clamp` miền thô, `<loop.index>` cần miền theo count, bản copy contracts trong node_modules cũ (file root từ container); CI [37504105376](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37504105376) 11/11 (E2E 16/16 lần đầu) | T08 |
| Diagnostics catalog v1 (gồm 4 mã array mới ADR-0018) | 0016,0018 | ✔ | 2026-10-06 (Claude Code): catalog 51 mã (thêm `EDGE_FANOUT_NOT_ALLOWED`), builder `diag()` lấy severity/stage từ catalog, doc tự sinh `modules/simvehicleapp-contracts/DIAGNOSTICS_CATALOG.md` + guard (từ M3); i18n theo `code` + `data` máy đọc (studio dịch khi có bản dịch, ADR-0016 Notes). `error-codes.test.ts`: 30 mã error compile-time, mỗi mã một graph cố ý sai qua `compile()` ⇒ đúng mã + đúng `blockId`, test meta bắt thiếu mã; CI [37504105376](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37504105376) 11/11 (E2E 16/16 lần đầu) | T09 |
| Service `compiler` `/compile` (lint/verify/build) | 0014 | ✔ | 2026-10-06 (Claude Code): `/compile` 3 mode (build trả IR = golden), `target` tuỳ chọn ⇒ S7 qua `SV_BACKENDS` (OpenAPI nới, ADR-0014 Notes §12), 400/413/503; `/opcodes` (opcode sau khi hạ); test hợp đồng + perf 200 block build < 300 ms (trung vị 3 lần); CI [37504105376](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37504105376) 11/11 (E2E 16/16 lần đầu) | T10 |
| UI Verify + Problems panel + quick-fix `Convert` | 0016 | ✔ | 2026-10-06 (Claude Code): nút Verify (BFF `/api/sv/verify` → compiler `/compile` verify), kết quả chỉ áp cho graph đang có (sửa canvas ⇒ quay về lint ngay), Problems click ⇒ chọn block + focus field, quick-fix "Insert Convert to <kiểu>" (block Convert chèn trên mọi edge vào, tham chiếu `<convertN.result>`, ops collaborative); info = ghi chú, không tính là vấn đề; vitest 84 + tsc; E2E `m4-verify.spec.ts`; CI [37504105376](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37504105376) 11/11 (E2E 16/16 lần đầu) | T11 |
| `docs/IR_SPEC.md` tự sinh | 0014 | ✔ | 2026-10-06 (Claude Code): `modules/simvehicleapp-contracts/IR_SPEC.md` (trong module như DIAGNOSTICS_CATALOG, ADR-0009) sinh bởi `tools/gen-ir-spec.ts`: bảng cấu trúc từ schema, ngữ nghĩa backend (op `$expr`, chia/mod double, không tràn int64, `unit.convert` không FMA, `type.cast`, định dạng số, control flow) từ `tools/ir-spec.semantics.md`, ví dụ IR golden GW-A; `bun run check` fail nếu cũ; CI [37504105376](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37504105376) 11/11 (E2E 16/16 lần đầu) | T12 |

## M5 — Simulator
ADR: [0017](../analysis/adr/ADR-0017-simulator.md) · Phụ thuộc: M4 · Chi tiết: [phases/M05](../analysis/phases/M05-simulator.md)

| Feature | ADR | Trạng thái | Ghi chú | Task |
|---|---|---|---|---|
| VirtualClock + Strand giả lập + scheduler tất định | 0017 | ✔ | 2026-10-07 (Claude Code): `core/packages/simulator` — min-heap (t, seq), fiber generator + cancel token; chạy 2 lần cùng byte; CI [37517004426](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37517004426) | T01 |
| Interpreter opcode P0 | 0017 | ✔ | 2026-10-07 (Claude Code): `core/packages/simulator` — event.*, vehicle.*, control.*, state.*, comm.*, logic.eval/in_range; biểu thức theo IR_SPEC (int BigInt, float32 `fround`); conformance C01–C38 + 7 golden 45/45 PASS local | T02 |
| Concurrency policies (restart/ignore/queue/parallel) | 0012,0017 | ✔ | 2026-10-07 (Claude Code): `core/packages/simulator` — theo trigger, queueMax/maxRuns, trace cancel/queue_overflow (C09–C14) | T03 |
| Opcode P1 (switch/wait_until/repeat/while/parallel/condition/write_many) | 0017 | ✔ | 2026-10-07 (Claude Code): `core/packages/simulator` — switch, wait_until, repeat, while (loop_guard), parallel join all/any/none, condition trigger; `write_many` chưa có block sinh ra (`sv_set_many` dời theo quyết định PO 2026-10-04) | T04 |
| MockVehicle + MockMqtt | 0017 | ✔ | 2026-10-07 (Claude Code): `core/packages/simulator` — ghi actuator đặt target (không đổi giá trị hiện tại, GW-G), kiểm min/max/allowed khi có model; MQTT loopback theo filter `+`/`#` | T05 |
| Tracer TraceEvent v1 + ScenarioPlayer | 0017,0027 | ✔ | 2026-10-07 (Claude Code): `core/packages/simulator` — mọi event hợp lệ contract `trace-event` (test), `signals[]` riêng cho timeline; `checkExpectations` (writes chính xác, trace matcher theo thứ tự) | T06 |
| `POST /simulate` + giới hạn (24h ảo, 1e6 event) | 0017 | ✔ | 2026-10-07 (Claude Code): service compiler `/simulate` — validate `ir`/`scenario` theo contract (400), IR ≠ 1.x ⇒ 422, `SIM_LIMIT_REACHED` (mã mới, warning) khi chạm 1e6 sự kiện, `expectations` khi scenario có `expect`, thêm `signals/publishes/logs` (OpenAPI additive); perf 10 phút ảo < 1 s (test simulator); service 16 test | T07 |
| Simulator Web Worker (tuỳ chọn) | 0017 | ↷ | 2026-10-07 (Claude Code): không cần — điều kiện của phase là độ trễ service > 300 ms; đo thật trên stack E2E: `/compile` 64 ms + `/simulate` 35 ms. Package simulator thuần TS nên vẫn chạy được trong Worker nếu sau này cần | T08 |
| UI Scenario editor | 0017 | ✔ | 2026-10-07 (Claude Code): tab Simulation — bảng initial/inputs (signal hoặc `mqtt:topic`), độ dài chạy, chế độ YAML import/export (validate contract `scenario`), tự lưu (bảng `sv_workflow_scenarios`, migration 0251, BFF `/api/sv/workflows/[id]/scenario`); "record from Signals" để M8; vitest + tsc PASS local; E2E `m5-simulate` PASS CI 37517004426 | T09 |
| UI Simulation timeline + Replay overlay (`TraceOverlay`, dùng lại ở M8) | 0017,0027 | ✔ | 2026-10-07 (Claude Code): nút Simulate (BFF `/api/sv/simulate`: compile build ⇒ simulate; lỗi compile ⇒ Problems), timeline (input/trigger/write/log/publish/error/cancel), thanh tua + Play, badge replay trên block (`SvTraceBadge` + `replayAt`, chỉ hiện khi graph chưa đổi); E2E `m5-simulate.spec.ts` PASS CI 37517004426 (sửa lưu bản nháp d398a02, 44f06c5) | T10 |
| `expected.trace/writes` GW-A..G đóng băng | 0042 | ✔ | 2026-10-07 (Claude Code): sinh bằng `simulator/src/golden-trace.ts` từ `ir.json` + scenario, runId `golden`, test so byte; writes = kỳ vọng suy tay của scenario; review [M05-golden-trace-review](reviews/M05-golden-trace-review.md) (uỷ quyền PO) | T11 |

## M6 — C++ backend & runtime
ADR: [0020](../analysis/adr/ADR-0020-backend-plugin-contract.md), [0021](../analysis/adr/ADR-0021-cpp-runtime-library.md), [0022](../analysis/adr/ADR-0022-cpp-codegen-strategy.md) · Phụ thuộc: M0 (song song), M4 · Chi tiết: [phases/M06](../analysis/phases/M06-cpp-backend-and-runtime.md)

| Feature | ADR | Trạng thái | Ghi chú | Task |
|---|---|---|---|---|
| CMake/Conan package runtime (SDK 0.7.1) | 0021 | ✔ | 2026-10-07 (Claude Code): `compiler-code-cpp/runtime` CMake độc lập (C++17, nlohmann 3.11.3, gtest đúng pin template), build trong CI ubuntu; vendored vào project (ADR-0021 §8, Conan để P2); build trong toolchain image: `stage-project.sh` (project 7 golden) | T01 |
| `IClock`/`SteadyClock`/`VirtualClock` + `Strand` | 0021 | ✔ | 2026-10-07 (Claude Code): `Strand` (t, seq), `IClock`/`SteadyClock`, đồng hồ ảo (`runUntil`); gtest + ASan/UBSan + TSAN sạch local — CI [37531209412](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37531209412) | T02 |
| `IVehicleAccess` + `VelocitasVehicleAccess` | 0021 | ✔ | 2026-10-07 (Claude Code): `VelocitasVehicleAccess`/`VelocitasPubSub` theo path qua `IVehicleDataBrokerClient` (header/source SDK 0.7.1 đọc trong toolchain); biên dịch trong project thật (`stage-project.sh`), chạy live trên databroker + MQTT (`live-run.sh`: GW-A ghi Hazard; sửa lỗi uint8 của SDK) | T03 |
| `testing::MockVehicle` | 0021 | ✔ | 2026-10-07 (Claude Code): `testing::MockVehicle`/`MockPubSub`/`runScenario`/`checkExpectations` (mô hình simulator) — CI [37531209412](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37531209412) | T04 |
| `Runtime` (signal registry, onX handlers, policies, cancel) | 0012,0021 | ✔ | 2026-10-07 (Claude Code): `Runtime` interpreter mirror simulator (ADR-0021 Notes §1); conformance 45/45 local (ASan) — CI [37531209412](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37531209412) | T05 |
| `Ctx` API (read/write/wait/publish/log/trace/stop) | 0021 | ✔ | 2026-10-07 (Claude Code): builder `Workflow` + `Ctx` (out/signal/state/nowMs) thay API continuation (ADR-0021 Notes §1) — CI [37531209412](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37531209412) | T06 |
| `StateVar<T>` + loop helpers | 0021 | ✔ | 2026-10-07 (Claude Code): state/counter, repeat/while (loop guard), parallel join all/any/none trong runtime — CI [37531209412](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37531209412) | T07 |
| `Tracer` (SVTRACE) + `AppBase` | 0021,0027 | ✔ | 2026-10-07 (Claude Code): Tracer `SVTRACE` theo `runtimeLine` + `AppBase(appName, level)`; `AppBase` build + chạy live (`vdb.connected`, `app.started`) | T08 |
| Conformance runner C++ | 0042 | ✔ | 2026-10-07 (Claude Code): `generator/conformance/conformance.sh`: sinh C++ cho 38 conformance + 7 golden, build với runtime, so writes/trace matcher + golden trace từng event — 45/45 PASS local (cả ASan/UBSan) — CI [37531209412](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37531209412) | T09 |
| `docs/RUNTIME_API.md` | 0021 | ✔ | 2026-10-07 (Claude Code): `runtime/RUNTIME_API.md` sinh từ doc comment của header (`generator/conformance/gen-runtime-api.ts`, `--check` trong CI), vendored vào mỗi project cùng runtime — CI [37531209412](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37531209412) | T10 |
| Server `/capabilities /generate /runtime/files` + `backend.yaml` | 0020 | ✔ | 2026-10-07 (Claude Code): `generator/src/app.ts` + `backend.yaml`; contract test (capabilities/fileset/bundle/diagnostics) + smoke compose (S7, no-egress, read-only) — CI [37531209412](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37531209412) | T11 |
| `CodeWriter` + `sanitizeIdent` | 0022 | ✔ | 2026-10-07 (Claude Code): `CodeWriter` (source map, ≤100 cột), `cppString`/`commentText`/`sanitizeIdent` + fuzz 500 chuỗi + case fuzz qua trình biên dịch — CI 37531209412
| Naming tất định (VSS path→member, type map) | 0022 | ✔ | 2026-10-07 (Claude Code): tên class (PascalCase + hash khi trùng), biến local snake_case, map VSS→C++, kiểu tính mirror simulator (ADR-0022 Notes §2) — CI [37531209412](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37531209412) | T13 |
| Emitters P0 (trigger/vehicle/control/state/comm/`$expr`) | 0022 | ✔ | 2026-10-07 (Claude Code): emitter trigger/vehicle/control/state/comm/`$expr`; golden C++ GW-A,B,E diff 0 + chạy đúng trace — CI [37531209412](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37531209412) | T14 |
| Emitters P1 (switch/wait_until/repeat/while/parallel/condition) | 0022 | ✔ | 2026-10-07 (Claude Code): switch/wait_until/repeat/while/parallel/condition; golden GW-C,D,F,G; `write_many` không có block sinh ra (không khai báo trong backend.yaml) — CI [37531209412](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37531209412) | T15 |
| Project files (`SimVehicleApp.*`, `Main.cpp`, manifest fragment, sourcemap) | 0022,0023 | ✔ | 2026-10-07 (Claude Code): `SimVehicleApp.*` (host + kiểm model có kiểu), `Main.cpp`, `generated.cmake`, `simvehicleapp.gen.json`, sourcemap — CI [37531209412](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37531209412) | T16 |
| Template overlay (xoá SampleApp, `UserHooks.*`) | 0022,0023 | ✔ | 2026-10-07 (Claude Code): overlay (`app/src/CMakeLists.txt`, `user/UserHooks.*`, `app/tests/CMakeLists.txt`, `remove` SampleApp/Launcher); build thật trong toolchain image (offline): `build/bin/app` + 7/7 generated test | T17 |
| Tests sinh kèm (`*_test.cpp` từ scenario) | 0042 | ✔ | 2026-10-07 (Claude Code): `app/tests/generated/*_test.cpp` (scenario nhúng, `runScenario` + `checkExpectations`); 7 golden build + PASS trong conformance; 7/7 PASS trong project thật | T18 |
| Manifest fragment builder | 0023 | ✔ | 2026-10-07 (Claude Code): `manifestFragment` (write thắng read, sort, pubsub) + unit test — CI 37531209412
| Determinism test (2 lần, 2 OS) | 0006 | ✔ | 2026-10-07 (Claude Code): test generate 2 lần cùng byte; job CI thứ hai trên macOS so golden — CI [37531209412](https://github.com/ltnguyenlt2k/simvehicleapp/actions/runs/37531209412) | T20 |

## M7 — Workspace/Toolchain/SynCode
ADR: [0023](../analysis/adr/ADR-0023-velocitas-project-layout-and-manifest.md), [0025](../analysis/adr/ADR-0025-headless-velocitas-toolchain.md), [0026](../analysis/adr/ADR-0026-workspace-service.md) · Phụ thuộc: M6, M0 (song song) · Chi tiết: [phases/M07](../analysis/phases/M07-workspace-toolchain-syncode.md)

| Feature | ADR | Trạng thái | Ghi chú | Task |
|---|---|---|---|---|
| Vendor template C++ @275e858 + `UPSTREAM.md` | 0003,0025 | ✔ | Template @275e858 vendored ở M0 (`modules/velocitas-stack/templates/`, provenance `modules/velocitas-stack/UPSTREAM.md`, license scan) — Claude Code 2026-10-07 | T01 |
| `toolchain/cpp/Dockerfile` (theo S-1) | 0025 | ✔ | Image `toolchain-cpp` offline build (S-1) + agent; gate M7: build thật 9.8 s, incremental 2.7 s | T02 |
| toolchain-agent jobs (init/deps/build/test/run/…) + SSE | 0025 | ✔ | toolchain-agent: queue/SSE/cancel/plans + test (`55290a6`, `2132646`) | T03 |
| `GET /templates?lang=cpp` | 0025 | ✔ | `GET /templates?lang=cpp` tar tất định (test) | T04 |
| Auto `generate-model` khi đổi VSS release | 0025 | ✔ | generate-model khi VSS đổi (test M07-T05) | T05 |
| Path policy an toàn (ownedRoots, no symlink escape) | 0026 | ✔ | path policy + test bảo mật (ADR-0026 Notes §1, `ab04006`) | T06 |
| Init project (template+overlay+runtime→staging→rename) | 0026 | ✔ | init project (template+overlay+runtime+VSS) — gate: ready 32 s | T07 |
| Commit atomic + Generation Manifest + recovery | 0026 | ✔ | commit atomic + recovery; gate kill giữa commit PASS (`gate/m7-gate.sh`) | T08 |
| AppManifest merge v3 | 0023 | ✔ | merge AppManifest idempotent; gate SynCode lần 2 không đổi file | T09 |
| `GENERATED_FILE_MODIFIED` detection | 0026 | ✔ | `GENERATED_FILE_MODIFIED` (test) | T10 |
| Rollback 10 generation gần nhất | 0026 | ✔ | rollback 10 generation (test) | T11 |
| Schema `sv` (Drizzle) + migration | 0007 | ✔ | schema `sv` do orchestrator tự migrate (ADR-0026 Notes §8), test Postgres thật trong CI | T12 |
| Project API | 0007 | ✔ | Project API (`89117c6`), contract khoá (`c056e2a`) | T13 |
| GenerationPipeline + job queue + SSE `/events` | 0026 | ✔ | pipeline + queue SKIP LOCKED + SSE `/events`; gate GW-A+GW-B PASS | T14 |
| Error mapping (GCC/Clang→sourcemap→diagnostic block) | 0022,0026 | ✔ | `CPP_COMPILE_ERROR` → block b2/n2/gw_a (gate) | T15 |
| Response format chuẩn | 0007 | ✔ | Appendix A/B, test OpenAPI | T16 |
| Studio: Project page | 0007 | ✔ | trang Vehicle projects + `sv_projects`; E2E mock + `@live` PASS | T17 |
| Nút SynCode + progress SSE + Build log + diagnostics map | 0026 | ✔ | SynCode + Build log + diagnostics → block; Playwright pass/fail (CI 37543884072) + `@live` thật | T18 |
| Generated files viewer (diff với generation trước) | 0026 | ✔ | trình xem file + diff generation trước; `@live`: diff 120 → 125 | T19 |

## M8 — Live Run & Observability
ADR: [0024](../analysis/adr/ADR-0024-databroker-api-and-runtime-stack.md), [0027](../analysis/adr/ADR-0027-live-run-logs-and-trace.md) · Phụ thuộc: M7, M5 · Chi tiết: [phases/M08](../analysis/phases/M08-live-run-observability.md)

| Feature | ADR | Trạng thái | Ghi chú | Task |
|---|---|---|---|---|
| Compose runtime (databroker/mosquitto/mock-provider theo project) | 0024 | ✔ | Claude Code 2026-10-07: databroker 0.5.0 + mosquitto trong stack dev; live smoke nightly 37559343111 PASS ([M08](reports/M08.md)) | T01 |
| Nhiều VSS release → nhiều databroker (profile) | 0024 | ✔ | databroker v4.2 bật mặc định + map `SV_DATABROKERS` (ADR-0024 Notes M8); test orchestrator chọn broker theo release | T02 |
| RunManager + state machine | 0027 | ✔ | một Run/stack, chỉ generation mới nhất, start timeout 30 s, SIGINT→SIGKILL 5 s, RUN_CRASHED, recover; gate M8 Stop 1 050 ms | T03 |
| toolchain `run` job (SSE stdout/stderr, exit code) | 0025,0027 | ✔ | log cuộn 50 000 dòng + seq bộ đếm (test 60 000 dòng) | T04 |
| TraceIngest (SVTRACE parse) + run_event ring buffer | 0027 | ✔ | bỏ ANSI, validate runtimeLine, lô 50 ms + coalesce `dropped`, lưu trước khi phát; ring 20 000 (test Postgres) | T05 |
| signal-gateway (kuksa.val.v1 WS, allowlist từ catalog) | 0024 | ✔ | SSE + POST thay WS (ADR-0027 Notes §6); 11 test + tích hợp databroker 0.5.0 thật; sửa một entry/path `1556124` | T06 |
| Scenario player trên databroker thật | 0017,0024 | ✔ | `/play` (signal + MQTT 3.1.1), kiểm trên stack thật | T07 |
| UI Run console + Signals panel + Trace overlay | 0027 | ✔ | `m8-run` mock PASS CI 37549237159; `m8-run-live @live` PASS 1.4 phút | T08 |
| "Record scenario from Signals" | 0017,0027 | ✔ | Record ⇒ scenario (initial + input có thời gian) ⇒ Simulation; trong `m8-run` | T09 |
| `scripts/smoke.sh` đầy đủ GW-A live | — | ✔ | nightly 37559343111 PASS trên runner sạch (M7+M8 live) | T10 |

## M9 — IDE & Export & License
ADR: [0028](../analysis/adr/ADR-0028-ide-code-server.md), [0031](../analysis/adr/ADR-0031-export-and-licensing.md) · Phụ thuộc: M7 · Chi tiết: [phases/M09](../analysis/phases/M09-ide-export-license.md)

| Feature | ADR | Trạng thái | Ghi chú | Task |
|---|---|---|---|---|
| `ide-vscode/cpp` Dockerfile (code-server 4.139.1 + extension whitelist) | 0028 | ✔ | code-server 4.139.1 trên toolchain-cpp, extension whitelist; HEALTHCHECK riêng (/healthz) | T01 |
| settings/tasks/launch overlay + clangd | 0028 | ✔ | tasks Build/Test/Run on stack + launch gdb mức user; gate M9 local: Build/Test xanh, Run on stack `vdb.connected`/`app.started` | T02 |
| Compose `ide-cpp` | 0028 | ✔ | service `ide-cpp` (volume workspace chung, mật khẩu `.env`, 127.0.0.1) | T03 |
| `editor.url` trong response SynCode + nút Open IDE | 0028 | ✔ | `Project.editor.url` + nút Open IDE; `m9-ide-export-live @live` PASS 1.2 phút (code-server mở project, thấy file sinh) | T04 |
| Cảnh báo IDE chạy song song Live Run | 0028 | ✔ | nhắc trong Run console + `sv-run-on-stack` | T05 |
| Export zip (`.svexportignore`, NOTICE, THIRD-PARTY-NOTICES) | 0031 | ✔ | zip tất định 95 file; build bằng `app/Dockerfile` template trên runner sạch (nightly 37559343111) | T06 |
| EntitlementService + license PDP (gắn export/IDE/SynCode/AI) | 0031,0032 | ✔ | Ed25519 offline, `full`/`enforce`; gate: export + Python bị chặn 403, C++ được phép | T07 |
| Import lại project (round-trip `.graph.json`) | 0031 | ✔ | `graphToSimState` round-trip 7 golden + importer Sim | T08 |

## M10 — AI Assistant & MCP
ADR: [0030](../analysis/adr/ADR-0030-ai-assistant-mcp.md) · Phụ thuộc: M4, M5, M8 · Chi tiết: [phases/M10](../analysis/phases/M10-ai-assistant-mcp.md)

| Feature | ADR | Trạng thái | Ghi chú | Task |
|---|---|---|---|---|
| Quyết định kiến trúc provider (spike 1 ngày) | 0030 | ✔ | Claude Code 2026-10-07: adapter `fetch` riêng, không dùng provider của Sim (ADR-0030 Notes 2026-10-07 §1) | T01 |
| Provider adapter (anthropic/openai/gemini/ollama) + streaming/tool-calling | 0030 | ✔ | anthropic/openai/openai-compatible/ollama/gemini (native), test HTTP giả; chạy thật với Ollama `qwen3.5:9b`; lỗi provider che key | T02 |
| Tool registry + MCP server (12 tool v1, SAFE/SENSITIVE) | 0030 | ✔ | 13 tool (SAFE/SENSITIVE tĩnh), MCP Streamable HTTP stateless + bearer (so khớp hằng thời gian); test bằng client MCP SDK 1.32.1 | T03 |
| Agent loop (max 6 step, confirmation gate) + SSE `/chat` | 0030 | ✔ | test LLM kịch bản: required-field guard, 409 khi chờ xác nhận, `editedInput` thắng, cancel; nhắc nội bộ ≤ 2 | T04 |
| WorkflowPatch v1 (apply-on-draft, validate, auto-fix) | 0030 | ✔ | áp lên bản nháp + `/compile` verify + khối không tới được/prop lạ là lỗi, gợi ý sửa cụ thể cho model | T05 |
| MCP client (`ext.*` namespace, confirmation mặc định) | 0030 | ✔ | `ext__<server>__<tool>` (tên tool provider không cho dấu chấm), luôn SENSITIVE trừ `safeTools` | T06 |
| Store `sv_ai` + retention | 0030 | ✔ | Postgres schema `sv_ai` (migration 0001), purge theo `SV_AI_RETENTION_DAYS`; test Postgres thật (CI job `ai`) | T07 |
| Studio Assistant panel (patch preview diff, confirmation card) | 0030 | ✔ | Claude Code 2026-10-07: BFF `/api/sv/ai/*`, đề xuất hiện trên canvas bằng diff view (Accept/Reject), thẻ xác nhận sửa được input; vitest 11; Playwright `m10-assistant` PASS CI 37567807281 | T08 |
| System prompt + eval set 20 prompt (VI/EN) | 0030 | ✔ (BYPASS) | Eval với LLM thật **bypass theo quyết định PO 2026-10-07** (chưa có API key; local 9B: 65–80 %) — đo lại khi có key. Thay bằng `eval/mcp-live.sh`: 13 tool qua MCP trên stack thật 36/36 PASS ([M10](reports/M10.md)) | T09 |
| Bảo mật AI (no key xuống browser, rate limit, redact) | 0030 | ✔ | review: key chỉ trong container, `/status` không trả key, user từ session BFF, rate limit theo user, lỗi provider che key, license `ai.assistant` (fail closed) | T10 |

## M11 — Hardening → Release v1.0
ADR: [0032](../analysis/adr/ADR-0032-auth-and-tenancy.md), [0033](../analysis/adr/ADR-0033-observability.md), [0042](../analysis/adr/ADR-0042-semantic-parity-testing.md) · Phụ thuộc: M8, M9, M10 · Chi tiết: [phases/M11](../analysis/phases/M11-hardening-release.md)

| Feature | ADR | Trạng thái | Ghi chú | Task |
|---|---|---|---|---|
| Parity P3 (binary thật) GW-A..G, nightly dashboard | 0042 | 🔄 | Claude Code 2026-10-07: `gate/parity-p3.sh` — **7/7 local** (lệch ≤ 7 ms, [bằng chứng](reports/evidence/M11-parity-p3-local.json)); bước nightly + artifact `parity-p3`; sửa bộ phát scenario (đồng hồ monotonic). Chờ nightly xanh | T01 |
| Playwright E2E đầy đủ (tutorial, 7 golden, IDE, export, AI giả) | 0042 | 🔄 | 2026-10-07: `tutorial-live @live` PASS 1,1 phút (canvas ⇒ Simulate ⇒ SynCode ⇒ Run ⇒ inject ⇒ trợ lý giả lập; quay video demo README); 7 golden (`m3-goldens`), IDE + export (`m9-ide-export-live`), AI (`m10-assistant`, LLM kịch bản) đã có. Chờ nightly xanh 3 ngày | T02 |
| Cleanup Sim đợt 3 (knip, dependency thừa) | 0008 | 🔄 | 2026-10-07 đợt 3a: gỡ 221 block tích hợp + tools/triggers/routes/connectors (5 128 file, ~794k dòng), 20 dependency, Deploy/Run của Sim; tsc + 8 378 test pass. Đợt 3b (block AI lõi, hạ tầng OAuth tích hợp, nâng next/axios/sharp/…) chờ PO — ADR-0008 Notes 2026-10-07. Đo (CI 37582304898 → 37584792096): image studio 392 → 302 MB (−23 %), dựng image + E2E 17 m 47 s → 10 m 28 s, type-check + test 7 m 37 s → 5 m 25 s | T03 |
| Auth/tenancy BFF permissions | 0032 | ✔ | 2026-10-07: rà 31 route `/api/sv/*` — mọi route kiểm phiên + quyền workspace/workflow/project, route ghi đòi `write`; test viewer không SynCode/Run; service nội bộ không truy cập được từ host (curl 4010–4210 thất bại, 4300 ⇒ 401). UI SSO clean-room: follow-up | T04 |
| Observability (`/metrics`, log correlation, status page) | 0033 | ✔ | 2026-10-07: `/metrics` mọi service (histogram stage SynCode, kết quả theo mã diagnostic, run, trace, job toolchain); một SynCode truy vết qua 6 service bằng `generationId`; trang System status (ADR-0033 Notes 2026-10-07). Profile Prometheus/Grafana: P2 | T05 |
| Security checklist + fuzz + osv-scanner | — | 🔄 | 2026-10-07: osv-scanner (CI, digest ghim) — 6 module của dự án sạch sau nâng ajv/grpc-js; studio (deps fork Sim) 75 gói chờ T03; container `cap_drop: ALL` + `no-new-privileges`, compiler/catalog/codegen read-only | T06 |
| Performance benchmark (validate/compile/simulate/SynCode) | — | ✔ | 2026-10-07 `gate/bench-nfr02.sh`: validate 200 khối p95 16 ms (< 300), simulate p95 39 ms (< 1 s), SynCode project mới 13 s, tăng dần p95 5,6 s (< 60 s) — [bằng chứng](reports/evidence/M11-bench-nfr02-local.json) | T07 |
| Docs đầy đủ (user guide + dev docs) | — | 🔄 | 2026-10-07: [tutorial](user-guide/tutorial.md), [tham chiếu khối](user-guide/blocks.md) (sinh từ BlockSpec, CI kiểm), [BLOCK_SDK](dev/BLOCK_SDK.md), [ADD_NEW_BLOCK](dev/ADD_NEW_BLOCK.md), [BACKEND_PLUGIN](dev/BACKEND_PLUGIN.md), [OPERATIONS](dev/OPERATIONS.md); IR_SPEC/DIAGNOSTICS_CATALOG/RUNTIME_API có sẵn — chờ review PO | T08 |
| Usability test 5 người (tutorial < 10') | — | ☐ | Cần 5 người thật — chờ PO tổ chức; kịch bản: [tutorial](user-guide/tutorial.md) (E2E tự động cùng kịch bản: 1,1 phút) | T09 |
| Release v1.0.0 (split repo, bootstrap, tag, lock, images, CHANGELOG) | 0002,0009 | 🔄 | 2026-10-07: `bootstrap.sh` (lần 2: 28 s), `modules.sh` (lock tất định), `lock-verify.sh` (PASS; từ chối SHA sai), `release-split.sh` dry-run 10/10 module đúng cây, [CHANGELOG](../CHANGELOG.md) 1.0.0-rc.1. Tách repo/tag/publish image: hành động ra ngoài — chờ PO | T10 |

**Exit checklist v1.0 (đủ cả 6 mới coi MVP xong):**
- [ ] 7 golden workflow: simulate ✔, SynCode build ✔, generated tests ✔, live run ✔ trên databroker thật, parity ✔.
- [ ] Tutorial "Overspeed warning" < 10 phút (5 người).
- [ ] `scripts/bootstrap.sh`/`scripts/sv` từ máy sạch → UI chạy < 30 phút lần đầu, < 2 phút lần sau.
- [ ] Không còn `ee/`, copilot, pii, block AI cũ trong codebase; license scan sạch.
- [ ] Security checklist pass.
- [ ] Tài liệu dev đầy đủ (BLOCK_SDK, ADD_NEW_BLOCK, IR_SPEC, DIAGNOSTICS_CATALOG, RUNTIME_API, BACKEND_PLUGIN).

## M12 — Python backend
ADR: [0040](../analysis/adr/ADR-0040-python-backend.md) · Phụ thuộc: M11 · Chi tiết: [phases/M12](../analysis/phases/M12-python-backend.md)

| Feature | ADR | Trạng thái | Ghi chú | Task |
|---|---|---|---|---|
| Vendor template python @e7082f7 + toolchain Dockerfile | 0040 | ✔ | 2026-10-07: image `toolchain-python` (wheelhouse offline, ruff 0.9.10); `stage-project.sh` offline (`--network none`) 7 golden: deps/build/test/format PASS | T01 |
| Agent jobs python (pip/pytest/ruff) | 0040 | ✔ | 2026-10-07: plan theo `SV_TOOLCHAIN`; pytest báo cáo kiểu gtest; byte-code ngoài project; test agent 10/10 | T02 |
| Runtime `simvehicleapp_runtime` (asyncio) + conformance | 0040,0042 | ✔ | 2026-10-07: port runtime C++ + host SDK 0.15.7; conformance P1 46/46; unit 37/37; parity P3 7/7 trên KUKSA (lệch ≤ 3 ms) — [report](reports/M12.md) | T03 |
| Generator emitters Python | 0040 | ✔ | 2026-10-07: golden GW-A..G diff 0; code ổn định `ruff format`, `ruff check` sạch; CI `codegen-python` + smoke image | T04 |
| `compose.lang-python.yaml` + ide-python | 0040 | ✔ | 2026-10-07: thực hiện bằng profile `python` (ADR-0040 Notes §7); ide-python :8081; E2E Open IDE PASS | T05 |
| UI language=python | 0040 | ✔ | 2026-10-07: chọn ngôn ngữ trên trang Projects; `@live m12-python-live` PASS 50 s | T06 |

## M13 — Rust backend (feasibility)
ADR: [0041](../analysis/adr/ADR-0041-rust-backend-feasibility.md) · Phụ thuộc: M11 · Chi tiết: [phases/M13](../analysis/phases/M13-rust-backend.md)

| Feature | ADR | Trạng thái | Ghi chú | Task |
|---|---|---|---|---|
| Template `vehicle-app-rust-template` | 0041 | ☐ | | T01 |
| Runtime `simvehicleapp-runtime-rs` + conformance | 0041,0042 | 🔄 | Claude Code 2026-10-07 | T02 |
| Client `kuksa-rust-sdk 0.2.2` | 0041 | ☐ | | T03 |
| Generator emitters P0 → GW-A | 0041 | ☐ | | T04 |
| toolchain-rust (cargo vendor offline) | 0041 | ☐ | | T05 |
| Báo cáo feasibility (Go/No-go) | 0041 | ☐ | | T06 |

## M14 — Mở rộng sau v1.0 (backlog)
Chi tiết: [phases/M14](../analysis/phases/M14-services-curated-multiuser.md). **Mỗi dòng cần viết ADR riêng trước khi bắt đầu** — chưa có ADR nào trong nhóm này được viết; cột trạng thái dùng `☐ chưa có ADR` thay cho task cụ thể.

| # | Hạng mục | ADR dự kiến | Trạng thái |
|---|---|---|---|
| 1 | Curated multi-VSS blocks (Battery/Door/Climate Status) | 0045 | ☐ chưa có ADR |
| 2 | gRPC service interface | 0043 | ☐ chưa có ADR |
| 3 | Standalone service apps | 0044 | ☐ chưa có ADR |
| 4 | Per-run runtime stack & multi-user workspaces | 0046 | ☐ chưa có ADR |
| 5 | Migrate `kuksa.val.v2` | 0047 | ☐ chưa có ADR |
| 6 | Quick Run interpreter app | 0048 | ☐ chưa có ADR (chỉ nếu nhu cầu thực tế) |
| 7 | Sub-workflow/function, state machine block, filters | — | ☐ chưa có ADR |
| 8 | Kanto deployment | — | ☐ chưa có ADR |
| 9 | Reverse proxy + SSO forward-auth cho IDE | — | ☐ chưa có ADR |
| 10 | VSS overlay OEM (vss-tools pipeline) | — | ☐ chưa có ADR |


## M15 — E2E toàn diện + video demo (bước cuối)
Phụ thuộc: **toàn bộ** M0–M14 (plan, ADR, ROADMAP xong) · Chi tiết: [phases/M15](../analysis/phases/M15-final-e2e-demo-video.md) · Yêu cầu PO 2026-10-06.

| Feature | ADR | Trạng thái | Ghi chú | Task |
|---|---|---|---|---|
| Ma trận kịch bản E2E `e2e/SCENARIOS.md` | — | ☐ | truy ngược FR/ADR | T01 |
| Kéo thả từ toolbar: mọi block, vào/ra container, thả bị từ chối | — | ☐ | | T02 |
| Kéo thả từ panel Vehicle: mọi kind × release v4.0/v4.2, menu đúng kind | 0010, 0011 | ☐ | | T03 |
| Nối mọi handle, nối sai bị chặn, undo/redo, copy/paste, đổi tên ⇒ ref cập nhật | 0011, 0013 | ☐ | | T04 |
| 7 golden dựng hoàn toàn bằng UI, Problems sạch, graph khớp golden | 0042 | ☐ | | T05 |
| Full luồng signup → dựng → lint → Simulate → SynCode → build → Run → Signals → IDE → Export → AI → restart | toàn bộ | ☐ | | T06 |
| Cộng tác realtime + mất kết nối/restart service | — | ☐ | | T07 |
| 3 run CI xanh liên tiếp, 0 flaky | — | ☐ | | T08 |
| Kịch bản quay video tất định `scripts/sv demo-video` (1920×1080, chú thích) | — | ☐ | | T09 |
| Hậu kỳ + checklist xem video (PO ký) | — | ☐ | | T10 |
| Video trong README tổng, kiểm hiển thị thật trên GitHub | — | ☐ | | T11 |
| Báo cáo `docs/reports/M15.md` | — | ☐ | | T12 |

---

*Cập nhật lần cuối: 2026-10-07 (thêm M15 theo yêu cầu PO). Người/agent cập nhật file này phải tự chịu trách nhiệm về tính đúng của bằng chứng ghi trong cột Ghi chú — không tick `✔` khi chưa chạy test thật (xem skill `simvehicleapp-phase-execution`).*

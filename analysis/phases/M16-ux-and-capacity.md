# M16: Trải nghiệm end-user và kiểm soát tài nguyên host

> **Yêu cầu:** PO 2026-10-14.
> **Thiết kế:** [docs/design/M16-ux-and-capacity.md](../../docs/design/M16-ux-and-capacity.md).
> **ADR:** [0053](../adr/ADR-0053-vehicle-app-lifecycle-and-capacity.md), [0054](../adr/ADR-0054-editor-actions-and-focused-ui.md), [0055](../adr/ADR-0055-block-visual-semantics.md) (Proposed, theo uỷ quyền PO 2026-10-06, chờ xác nhận).
> **Nguyên tắc:**
> - làm **tuần tự** từng task; task sau chỉ bắt đầu khi task trước có test xanh;
> - mọi lỗi phát sinh trong lúc làm được sửa và ghi lại, không bỏ qua;
> - type-check/test nặng của studio chạy trên CI, không chạy local (WSL 11 GB).

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | Thiết kế + ADR 0053–0055 + phase + ROADMAP | docs | — | Tài liệu commit; ADR Proposed |
| T02 | Nền tảng vòng đời ở tầng thấp | contracts, workspace, toolchain | T01 | Contracts: workspace `DELETE /projects/{slug}`, `POST …/clean`, `GET …/size`, `GET /capacity`; toolchain `POST /projects/{slug}/forget`; mã `APP_QUOTA_EXCEEDED`, `HOST_DISK_LOW`, `SYNCODE_QUEUE_FULL`. Unit: xoá đúng phạm vi, slug sai bị từ chối, idempotent; clean giữ mã nguồn; capacity đọc `statfs` |
| T03 | Orchestrator: delete/repair/clean, quota, ngưỡng đĩa, gộp hàng đợi, sweeper, metrics | orchestrator | T02 | Unit đủ nhánh: 409 khi đang SynCode, dừng run, quota, 3 ngưỡng (đĩa giả), gộp + 429, sweeper (đồng hồ giả), `/metrics` |
| T04 | Studio BFF + trang **Vehicle apps**: giải thích, xoá (xác nhận), repair, clean, dung lượng, quota, reconcile rác | studio | T03 | Route kiểm quyền + test; reconcile chỉ xoá app mồ côi; E2E delete |
| T05 | Tự tạo app từ SynCode + System status dung lượng + DEPLOY.md | studio, docs | T04 | Workflow mới ⇒ hộp thoại ⇒ app ready ⇒ build; lỗi quota/đĩa hiện dễ hiểu |
| T06 | Thanh hành động: `SvActionButton`, primary, chip app, pill trạng thái, dòng gợi ý | studio | T05 | Vitest trạng thái + primary; E2E spinner ⇒ ✓ |
| T07 | UI tập trung: ẩn Tables/Files/KB/Logs + Settings thừa, đổi nhãn "Vehicle apps" | studio | T06 | Vitest hidden-routes + settings; E2E sidebar |
| T08 | Block: câu tóm tắt, màu/nhãn loại, nhãn cổng | studio | T07 | Test mọi BlockSpec; golden/IR/conformance không đổi |
| T09 | Nhãn cạnh + chip dữ liệu + highlight nguồn | studio | T08 | Vitest; E2E GW-A |
| T10 | Gate `m16-capacity.sh` + E2E tổng + báo cáo M16 + nightly | orchestrator, studio, docs | T09 | Gate PASS trên stack; CI xanh; `docs/reports/M16.md` |

## Acceptance gate
1. Người dùng mới:
   - mở workflow, bấm SynCode, được hỏi tạo app một lần, build xanh, Run được;
   - không phải vào trang khác.
2. App xoá/repair/clean được; xoá trả lại dung lượng (đo `du`); không còn rác mồ côi sau khi xoá workspace.
3. Kiểm soát tài nguyên:
   - vượt quota hoặc ngưỡng đĩa bị chặn trước, kèm thông báo và hành động gợi ý;
   - hàng đợi SynCode có giới hạn;
   - sweeper thu hồi theo cấu hình.
4. Mọi nút hành động có trạng thái rõ (spinner/✓/✕), có hành động chính, thấy app đích.
5. Sidebar/Settings chỉ còn phần phục vụ toolchain.
6. Block hiện câu tóm tắt và màu loại; cạnh nhánh có nhãn; golden/IR/conformance/parity không đổi.
7. CI xanh; nightly xanh; live smoke + gate VSS tuỳ biến + parity vẫn PASS.

## Hiện trạng đo được (2026-10-14, máy dev)
- **89 app**, `/workspace/projects` **9,1 GB** (volume `sv-workspace` 9,7 GB). Phần lớn là app do gate/test tạo: parity-p3 28, vss-custom 12, overspeed 11, smoke 6, gate m7/m8/m9…
- Volume `sv-velocitas` **8,7 GB**: venv riêng của từng project cũ, có từ trước khi dùng chung venv (ADR-0051). Không còn project nào trỏ tới các venv đó ⇒ là rác mồ côi.
- `sv-ccache` 574 MB, `sv-rust-target` 540 MB, `sv-conan2` 468 MB.

## Checklist chi tiết từng task (đánh dấu khi làm xong, kèm bằng chứng ở ROADMAP)

### T02: Nền tảng vòng đời (contracts, workspace, toolchain)
- [x] **Contracts:**
  - workspace `DELETE /projects/{slug}`, `POST /projects/{slug}/clean`, `GET /projects/{slug}/size`, `GET /capacity`;
  - toolchain `POST /projects/{slug}/forget`, `POST /gc`;
  - orchestrator `DELETE /projects/{id}`, `POST /projects/{id}/repair`, `POST /projects/{id}/clean`, `GET /capacity`;
  - CHANGELOG ghi rõ đây là thay đổi additive.
- [x] **Diagnostics catalog** (chỉ thêm, sinh lại `DIAGNOSTICS_CATALOG.md`): `APP_QUOTA_EXCEEDED`, `HOST_DISK_LOW`, `SYNCODE_QUEUE_FULL`.
- [x] **Workspace delete:**
  - kiểm slug (`SLUG`), chặn path traversal;
  - xoá `projects/<slug>`, `.sv/generations/<slug>`, `.sv/backup/*` của các generation thuộc slug;
  - không đụng project khác;
  - idempotent (404 → coi như đã xoá) và chạy trong `store.serialize(slug)` để không xoá giữa lúc commit;
  - sau khi xoá, tạo lại app trùng slug vẫn được.
- [x] **Workspace clean:** xoá `build*/` (C++), cache Python, `target/` (Rust) trong project; giữ mã nguồn và generated; xoá trong lúc build đang chạy thì trả 409 (orchestrator kiểm).
- [x] **Workspace size/capacity:**
  - size = tổng byte của thư mục project, có giới hạn thời gian đo;
  - capacity = `statfs` của root (free/total), kèm 3 mức ngưỡng tính từ env.
- [x] **Toolchain forget/gc:**
  - forget xoá `~/.velocitas/projects/md5(path)` (không theo symlink của venv dùng chung);
  - gc nhận danh sách đường dẫn còn sống và xoá mọi thư mục cache khác **trừ** cache của seed (venv dùng chung);
  - test thật bằng bash trên HOME tạm.
- [x] **ccache:** `CCACHE_MAXSIZE=${SV_CCACHE_MAX:-2G}` trong compose (toolchain-cpp, ide-cpp).
- [x] Unit test: mỗi route có ca thành công, ca slug sai, ca idempotent; module `check` + `test` xanh.

### T03: Orchestrator
- [x] **Delete:**
  - đang có generation `queued/running` ⇒ 409;
  - có run active ⇒ stop trước (chờ tối đa 10 s);
  - gọi workspace delete → toolchain forget (lỗi toolchain không chặn; sweeper dọn sau) → xoá DB (cascade);
  - idempotent.
- [x] **Repair:** chỉ app `failed`; xoá thư mục; tạo lại qua đường tạo app sẵn có, giữ workflows/settings; trạng thái `creating` → `ready/failed`.
- [x] **Clean:** từ chối khi đang SynCode/Run; sau clean đặt `depsInstalled=false` để lần build sau cài lại dependency.
- [x] **Quota toàn host + workflow/app** (`APP_QUOTA_EXCEEDED`, `scope: host`).
- [x] **Ngưỡng đĩa:**
  - đọc capacity của workspace (cache 30 s);
  - dưới high ⇒ chặn tạo/repair; dưới flood ⇒ chặn SynCode (`HOST_DISK_LOW`);
  - workspace không trả lời ⇒ fail-open có log cảnh báo (không chặn người dùng vì lỗi đo).
- [x] **Hàng đợi:**
  - generation mới của app có sẵn một `queued` ⇒ cái cũ `cancelled` (sự kiện SSE báo người đang theo dõi);
  - tổng `queued` ≥ giới hạn ⇒ 429 `SYNCODE_QUEUE_FULL`.
- [x] **Sweeper** mỗi giờ (đồng hồ inject được):
  - clean app nhàn rỗi;
  - delete app `failed` quá TTL;
  - toolchain `gc` với danh sách app còn sống.

  Ghi log + metrics số app/dung lượng đã thu hồi.
- [x] **`/metrics`:** `sv_workspace_free_bytes`, `sv_apps_total`, `sv_generation_queue_length`, `sv_reclaimed_bytes_total`. **`GET /capacity`** cho studio/System status.
- [x] **AI tool `project_syncode`:** lỗi 409/429 trả về chữ dễ hiểu cho LLM (test có sẵn trong `simvehicleapp-ai`).
- [x] Unit test mọi nhánh trên; PG test (CI) cho cascade.

### T04: Studio BFF + trang Vehicle apps
- [x] Contract studio (`lib/api/contracts/sv.ts`) cho delete/repair/clean/size/capacity; route bọc `withRouteHandler`, kiểm quyền: delete/repair/clean cần `write` (admin của workspace).
- [x] Quota workspace trong BFF lúc tạo app (đếm `sv_projects`) ⇒ `APP_QUOTA_EXCEEDED` (`scope: workspace`).
- [x] Xoá app ⇒ xoá dòng `sv_projects` sau khi orchestrator báo thành công. Lỗi giữa chừng không để lại trạng thái lệch: orchestrator idempotent, retry an toàn.
- [x] **Reconcile:**
  - app trong orchestrator không còn dòng `sv_projects` (workspace bị xoá) ⇒ delete;
  - dòng `sv_projects` mà orchestrator không còn ⇒ xoá dòng;
  - chạy tối đa 1 lần/giờ/tiến trình khi tải trang + nút "Reclaim" cho admin;
  - **không** bao giờ xoá app của workspace khác đang tồn tại;
  - app do gate/AI tạo không qua studio không có dòng `sv_projects` ⇒ reconcile chỉ xoá app có tiền tố gate/test hoặc khi admin xác nhận. Bảo vệ: chỉ xoá app orchestrator mà studio **từng** biết (lưu tombstone) + app gate theo tiền tố.
- [x] **Trang Vehicle apps:**
  - tiêu đề + câu giải thích "Vehicle app là chương trình chạy trên xe sinh từ workflow…";
  - mỗi app: trạng thái, ngôn ngữ thật, VSS, kích thước, lần SynCode cuối, workflow kèm release (đã có);
  - menu Repair (khi failed) / Clean / Delete (hộp thoại gõ tên);
  - thanh quota "3/10 app · 1,2 GB".
- [x] Workflow đã xoá ⇒ tự bỏ khỏi app (lúc tải trang + lúc SynCode); app không còn workflow ⇒ nhãn "unused".
- [x] Vitest cho route (quyền, quota, reconcile an toàn); E2E: tạo → xoá → biến mất.
- Bằng chứng 2026-10-15: vitest studio `app/api/sv` 13 file / 65 test PASS (gồm 11 test vòng đời, quota workspace, relay 409/507, bỏ qua workflow đã xoá); orchestrator 103 PASS (`GET /projects/{id}/size`); biome + `check:api-validation:strict` PASS; E2E `m7-syncode.spec.ts` thêm luồng xoá (gõ tên ⇒ thẻ biến mất). Lệch so với checklist (nút Reclaim, app gate, lần SynCode cuối): ADR-0053 Notes 2026-10-15.

### T05: Tự tạo app + System status + DEPLOY + dọn dữ liệu cũ
- [x] SynCode trên workflow chưa có app ⇒ hộp thoại `ChipModal`:
  - tên (gợi ý = tên workflow, slug hợp lệ, không trùng);
  - ngôn ngữ (chỉ ngôn ngữ đã cài);
  - VSS = release của workflow (khoá);
  - hoặc "Thêm vào app có sẵn" (chỉ các app cùng release).

  Xác nhận ⇒ tạo ⇒ chờ `ready` (hiện tiến trình) ⇒ tự SynCode.
- [x] Lỗi quota/ngưỡng/hàng đợi ⇒ thông báo tiếng người + nút "Mở Vehicle apps để dọn".
- [x] **System status:** thẻ "Disk" (free/total, mức ngưỡng, màu), số app/quota, hàng đợi SynCode.
- [x] **DEPLOY.md:**
  - mục "Dung lượng & quota" (biến env, cách đặt volume trên phân vùng riêng/quota XFS, cảnh báo theo metrics);
  - `.env.example` thêm các biến;
  - OPERATIONS.md: quy trình dọn.
- [x] `scripts/sv apps prune [--apply]` (mặc định dry-run); chạy trên máy dev, ghi dung lượng thu hồi.
  - 2026-10-15, máy dev, `prune --apply --e2e`: xoá 83/85 app và 6 thư mục mồ côi; báo 8.120 MB thư mục đã thu hồi; 0 app bị bỏ qua.
  - Chỉ còn 2 app của người dùng (`sample-test`, `sample-test-v4-2`).
  - Đo `du`: volume `sv-workspace` 8.927 → 127 MB, `sv-velocitas` 9.458 → 222 MB. Cache Velocitas được xoá theo từng app lúc delete; `POST /sweep` sau đó không còn gì để thu.
- [x] **Gate/smoke tự dọn:** `m7`, `m8`, `m9`, `parity-p3`, `vss-custom`, `bench`, `mcp-live` xoá app khi kết thúc (`trap`); E2E teardown xoá app.

### T06: Thanh hành động
- [x] `SvActionButton` (icon, label, state, emphasis, disabledReason) + test.
- [x] Hook trạng thái tổng hợp, suy ra từ store lint/sim/syncode/run, không lưu trùng.
- [x] Bố cục 3 nhóm, một nút primary đúng quy tắc, chip app đích, pill trạng thái (bấm mở panel tương ứng), dòng gợi ý lý do.
- [x] Giữ `data-sv-action`, `aria-busy`; nhãn nút giữ nguyên chữ ("SynCode", "Run"…) để E2E theo role/name không gãy.
- [x] Không chạy type-check studio local; biome theo file; vitest file nhỏ nếu RAM trống ≥ 3 GB.
- Bằng chứng 2026-10-15: `deriveSvActionStatus` (hàm thuần: nút primary, pill, dòng gợi ý) 6 test; `SvActionButton` 5 test jsdom (spinner/aria-busy, ✓/✕ 3 s chỉ khi vừa chạy xong, tên truy cập không đổi); test chrome editor + 15 file sv/store: 99 PASS. Trạng thái mới duy nhất được lưu là graph đã gửi SynCode (`sentGraphJson`), để biết bản build còn khớp canvas hay không. Hook trạng thái không mở stream SSE riêng (chỉ đọc query đã cache). Ô chọn "SynCode project" được thay bằng chip app (đổi app / tạo app khác / Manage vehicle apps).

### T07: UI tập trung
- [x] `hidden-routes.ts`: thêm tables/files/knowledge/logs + test.
- [x] Sidebar bỏ 4 mục; Settings chỉ giữ danh sách cho phép + redirect section ẩn + test.
- [x] Search modal (sidebar) không gợi ý tới module ẩn.
- [x] Đổi nhãn "Vehicle apps" và cập nhật 7 spec E2E + `tutorial.md` + test chrome.
- [x] Khai báo mọi file Sim thay đổi trong `UPSTREAM_SYNC.allow`.
- Bằng chứng 2026-10-15: `hidden-routes` 49 test PASS:
  - redirect tables/files/knowledge/logs/scheduled-tasks về danh sách workflow;
  - Settings chỉ còn allowlist general/teammates/organization/secrets/recently-deleted/admin, section ẩn redirect về General.

  Sidebar, Search (trang + dữ liệu) và Settings đều lọc theo **một** danh sách. Phím tắt ⌘⇧L (Logs) không làm gì. Đổi tên "Vehicle apps" và nhãn "App name"/"App folder" trong 8 spec E2E. `tutorial.md` và `tutorial-live` đi theo luồng SynCode → hộp thoại → tự build. Mọi file Sim đã sửa đều có trong `UPSTREAM_SYNC.allow`.
- Lệch so với thiết kế (theo uỷ quyền PO 2026-10-06 — chờ PO xác nhận):
  - ẩn thêm **Scheduled tasks**: lập lịch chạy agent AI, không có nghĩa cho vehicle app;
  - lọc Settings ở `settings-sidebar.tsx` thay vì sửa mảng `allNavigationItems`, để diff với upstream nhỏ.

### T08: Block: câu tóm tắt, màu, nhãn cổng
- [x] `lib/sv/block-summary.ts`: một quy tắc cho **mỗi** BlockSpec (41) + test bảng; test bảo đảm không spec nào thiếu quy tắc.
- [x] `lib/sv/handle-labels.ts`: bảng handle → nhãn/màu dùng chung.
- [x] `workflow-block.tsx`:
  - đầu thẻ cho `sv_*` (câu + màu + nhãn WHEN/DO);
  - nhãn cổng nhánh;
  - không đổi hành vi kéo, nối, chọn.
- [x] Golden graph-adapter + IR + conformance không đổi (chạy test core/contracts local; studio test trên CI).
- Bằng chứng 2026-10-15:
  - `block-summary` 26 test: đủ quy tắc cho cả 41 BlockSpec; block trống vẫn ra một câu; vai trò khớp category.
  - `handle-labels` 3 test: mọi nhánh có tên của spec đều có màu.
  - `lib/sv` + `blocks/vehicle` + `workflow-block`: 416 PASS, gồm golden graph-adapter GW-A…G. Không có thay đổi nào trong `simvehicleapp-core`/`contracts`, nên IR và conformance giữ nguyên byte.
  - Câu tóm tắt nằm ở dòng đầu thân block. Handle neo theo đỉnh/đáy nên không xê dịch, kéo/nối/chọn không đổi.
  - Dòng tóm tắt không đặt `title` vì helper E2E `nodeByName` tìm block theo `[title=<tên>]`.

### T09: Nhãn cạnh + chip dữ liệu
- [x] `workflow-edge.tsx`: nhãn + màu theo handle nguồn (bảng chung); cạnh lỗi giữ màu đỏ.
- [x] Chip "uses: …" dùng parser biểu thức có sẵn; rê chuột làm nổi block nguồn.
- [x] E2E: GW-A hiện câu tóm tắt; cạnh `stable` có nhãn.
- Bằng chứng 2026-10-15:
  - `block-refs` 4 test (tín hiệu/loop/parallel/variable không tính; ô bảng; toán tử `<` cạnh ref); `handle-labels` 4 test; sv + workflow-edge 116 PASS.
  - E2E `m3-goldens` (CI): với mỗi GW-A…G, số dòng tóm tắt bằng số block (trừ container), nhãn cạnh khớp đúng các nhánh, GW-A có "holds for 2 s". Cũng test đó kiểm graph adapt giống hệt `graph.json`.
  - Cạnh lỗi giữ màu đỏ. Màu chạy/diff vẫn ưu tiên hơn màu nhánh.

### T10: Gate + E2E + báo cáo
- [x] `gate/m16-capacity.sh` (stack dev):
  - tạo tới quota ⇒ lỗi đúng;
  - Clean/Delete trả dung lượng (`du`);
  - repair ⇒ ready;
  - hàng đợi gộp;
  - sweeper với TTL ngắn (env).
- [x] Nightly thêm gate (C++), các gate tự dọn.
- [x] CI xanh toàn bộ; nightly xanh; live smoke, parity, VSS gate vẫn PASS.
- [x] `docs/reports/M16.md` + ROADMAP + CHANGELOG + `sv refresh` localhost.
- Bằng chứng 2026-10-15:
  - gate PASS trên stack dev (`gate-m16-1792032182`); CI xanh 38669938414.
  - Nightly 38672732360 xanh: smoke, parity 7/7, gate VSS tuỳ biến, gate M16.

## Mối quan tâm xuyên suốt (soát ở mỗi task)
| Khía cạnh | Kiểm tra |
|---|---|
| Bảo mật/quyền | Mọi route mới kiểm phiên + quyền workspace; viewer không xoá/clean; đường dẫn đi qua `normalizeRelative`/`SLUG`; không `docker.sock` |
| Đồng thời | Xoá khi đang SynCode/Run/commit; hai lệnh xoá cùng lúc; sweeper chạy cùng thao tác người dùng (khoá theo app) |
| Idempotent/khôi phục | Mọi bước xoá lặp lại an toàn; lỗi giữa chừng không để lại rác; restart service giữa chừng |
| Tương thích ngược | Contract chỉ thêm; mã diagnostic chỉ thêm; project cũ dùng tiếp không cần migrate; route `/vehicle-projects` giữ |
| Tác động ngoài UI | AI/MCP tools, gate/smoke, E2E, `sv refresh`, release images, nightly |
| Tài liệu | design, ADR Notes khi lệch, ROADMAP, CHANGELOG (repo + contracts), DEPLOY, OPERATIONS, user guide, `.env.example` |
| Tài nguyên máy dev | Không type-check studio local; một tác vụ nặng một lúc; kiểm `free -g` trước tác vụ nặng |

# M16: Thiết kế lại trải nghiệm và kiểm soát tài nguyên

- **Yêu cầu PO:** ngày 2026-10-14.
- **ADR:** [0053](../../analysis/adr/ADR-0053-vehicle-app-lifecycle-and-capacity.md) (vòng đời ứng dụng xe + kiểm soát tài nguyên), [0054](../../analysis/adr/ADR-0054-editor-actions-and-focused-ui.md) (thanh hành động + UI tập trung), [0055](../../analysis/adr/ADR-0055-block-visual-semantics.md) (block thể hiện logic bằng hình).
- **Kế hoạch:** [phases/M16](../../analysis/phases/M16-ux-and-capacity.md) · [ROADMAP](../ROADMAP.md#m16--trải-nghiệm--kiểm-soát-tài-nguyên).

## 1. Vấn đề PO nêu và hiện trạng (khảo sát source 2026-10-14)

| # | Vấn đề | Hiện trạng thật trong code |
|---|---|---|
| P1 | "Vehicle project để làm gì? Tạo được mà không xoá được." | Project = thư mục app Velocitas (`/workspace/projects/<slug>`, mã sinh ra + build + test). Muốn SynCode phải tự tạo project rồi tick workflow ở trang riêng. Không có API xoá ở **mọi** tầng (studio BFF, orchestrator, workspace, toolchain). Project `failed` không có nút sửa (repair) hay thử lại. |
| P2 | Người dùng tạo vô tội vạ, đĩa host tăng không kiểm soát, quá tải lúc deploy thật | Không có quota project, không kiểm tra dung lượng trống. Một project ≈ 140 MB (thư mục build) + ~4 MB cache Velocitas, 10 bản generation. Hàng đợi SynCode **không giới hạn** (1 worker FIFO), nên một người bấm liên tục là chặn mọi người khác. Xoá workspace thì xoá dòng `sv_projects` của studio nhưng **thư mục và DB orchestrator vẫn còn** (rác mồ côi). `/metrics` không có số liệu đĩa. |
| P3 | Nút SynCode/Run/Stop/Open IDE đơn giản, không biết đang chạy hay bấm được | Tất cả là `Button variant='ghost'` chỉ có chữ. "Đang bận" chỉ đổi chữ ("SynCode…"). Không icon, không spinner, không phân cấp hành động chính/phụ, không hiện project đích. Lý do bị vô hiệu chỉ có trong `title` (tooltip). |
| P4 | Còn các mục thừa (chat, …) không phục vụ toolchain | Sidebar còn Tables, Files, Knowledge base, Logs của Sim (`/tables`, `/files`, `/knowledge`, `/logs`). Settings còn Billing, Custom tools, MCP tools, API keys, MCP servers, BYOK, Credential sets. Chat/home đã ẩn từ M01 (`hidden-routes.ts`). |
| P5 | Block ghép với nhau chưa diễn tả logic bằng hình | Block xe dùng thẻ chung của Sim: các dòng key/value chữ 10–11px ("Signal / Vehicle.Speed"). Cạnh nối không có nhãn: nhánh then/else, stable/broken, error trông như nhau. Không có câu tóm tắt ("Khi tốc độ đổi", "Nếu > 120 trong 2 s"), không phân biệt hình dạng trigger / điều kiện / hành động. |

## 2. Nghiên cứu (đối chiếu thực hành chuẩn)

- **Ngưỡng đĩa (disk watermark):** Elasticsearch dùng 3 mức: *low* 85 % (ngừng cấp phát mới), *high* 90 % (dời dữ liệu đi), *flood stage* 95 % (chỉ cho đọc).
  Kubelet đuổi pod khi `nodefs.available < 10 %`.
  ⇒ Dùng ngưỡng nhiều mức theo **dung lượng trống thật** của volume `sv-workspace`, chặn từ trước thay vì đợi hỏng.
- **Thu hồi theo thời gian / LRU:** cache GitHub Actions bị xoá khi 7 ngày không dùng và LRU khi vượt 10 GB/repo. Artifact GitLab có `expire_in`.
  ⇒ Bản build (tạo lại được) bị dọn khi project nhàn rỗi. Mã nguồn sinh ra thì giữ, vì SynCode tạo lại được trong ~15 s.
- **Quota trước, không phải dọn sau:** quota theo namespace (Kubernetes `ResourceQuota`) chặn ngay lúc tạo, trả lỗi rõ ràng.
  ⇒ Quota project theo workspace và tổng, kiểm tra ở **orchestrator** (nơi duy nhất tạo project).
- **Hàng đợi có giới hạn + gộp yêu cầu:** CI hệ thống huỷ run cũ khi có commit mới (`concurrency: cancel-in-progress`).
  ⇒ Mỗi project tối đa 1 SynCode `queued`; yêu cầu mới **thay** yêu cầu đang chờ; giới hạn tổng hàng đợi.
- **UX nút hành động:** nguyên tắc Nielsen "visibility of system status".
  ⇒ Mỗi hành động có icon + nhãn + trạng thái (idle / đang chạy có spinner / xong / lỗi). Hành động chính nổi bật (primary). Lý do không bấm được hiện ngay cạnh nút, không chỉ trong tooltip.
- **Ngôn ngữ trực quan cho luồng:** Scratch/Blockly phân loại theo màu và hình. Node-RED gắn nhãn cổng ra. Unreal Blueprint tách luồng thực thi (exec) và luồng dữ liệu.
  ⇒ Mỗi block có **màu loại + câu tóm tắt tiếng người**. Cổng ra nhánh có **nhãn màu** (then = xanh, else = xám, stable = xanh, broken = cam, error = đỏ), nhãn hiện cả trên cạnh. Tham chiếu dữ liệu (`<speedchanged.value>`) hiện thành chip "dùng: …".
  Chỉ lấy ý tưởng chung, **không** dùng code/tài sản Scratch (luật cứng 4).

## 3. Thiết kế

### 3.1 Vehicle app: tự động, có vòng đời đầy đủ (ADR-0053)

Khái niệm cho người dùng: **"Vehicle app"** = chương trình chạy trên xe sinh ra từ workflow. Đổi tên trang "Vehicle projects" thành **"Vehicle apps"** và thêm câu giải thích.

```
Workflow ──(SynCode lần đầu)──▶ tự tạo app "<tên workflow>" (VSS = release của workflow, ngôn ngữ = mặc định workspace)
   │                                    │
   └── nhóm nhiều workflow vào một app ─┘  (nâng cao: trang Vehicle apps)
```

- **Tự cấp phát:** bấm SynCode trên workflow chưa thuộc app nào sẽ mở hộp thoại một bước: "Tạo app *X* (C++/Python/Rust, VSS v4.0)?". Xác nhận xong, SynCode chạy luôn khi app `ready`. Không phải vào trang khác.
- **Vòng đời** (trang Vehicle apps và menu của app):
  - **Repair:** app `failed` → khởi tạo lại tại chỗ (xoá thư mục, init lại, giữ danh sách workflow).
  - **Clean:** xoá bản build (giữ mã nguồn).
  - **Delete:** dừng run đang chạy, từ chối khi đang SynCode, xoá thư mục + lịch sử generation + cache Velocitas + DB (cascade). Hộp thoại xác nhận gõ lại tên.
- **Hiển thị dung lượng:** kích thước từng app, tổng của workspace, thanh quota.

### 3.2 Kiểm soát tài nguyên host (ADR-0053 §Governance)

| Lớp | Cơ chế | Mặc định (`.env`) |
|---|---|---|
| Quota | Số app/workspace, tổng app/host; workflow/app | `SV_MAX_APPS_PER_WORKSPACE=10`, `SV_MAX_APPS_TOTAL=100`, `SV_MAX_WORKFLOWS_PER_APP=20` |
| Ngưỡng đĩa | Trống < *low*: cảnh báo trên System status; < *high*: **chặn tạo app**; < *flood*: **chặn SynCode** (chỉ còn xem/Run/Delete/Clean) | `SV_DISK_LOW_GB=10`, `SV_DISK_HIGH_GB=5`, `SV_DISK_FLOOD_GB=2` |
| Hàng đợi | 1 SynCode `queued` mỗi app (mới thay cũ); tổng hàng đợi giới hạn ⇒ 429 | `SV_MAX_QUEUED_GENERATIONS=20` |
| Thu hồi | Build của app nhàn rỗi > N ngày bị xoá; app `failed` > N ngày bị xoá; generation giữ N bản | `SV_IDLE_CLEAN_DAYS=14`, `SV_FAILED_TTL_DAYS=7`, `SV_KEEP_GENERATIONS=10` |
| Đối chiếu rác | Studio đối chiếu `sv_projects` với orchestrator; app không còn workspace (workspace bị xoá) bị xoá | khi tải trang Vehicle apps (≤ 1 lần/giờ) + nút "Reclaim" (admin) |
| Quan sát | `/metrics`: dung lượng trống, số app, hàng đợi; System status: thanh dung lượng + mức ngưỡng | — |
| Hạ tầng | DEPLOY.md: đặt volume `sv-workspace` trên phân vùng riêng / quota XFS; cảnh báo theo `/metrics` | tài liệu |

Mọi lỗi quota hay ngưỡng trả **mã diagnostic mới**, chỉ thêm, không đổi mã cũ (luật cứng 8): `APP_QUOTA_EXCEEDED`, `HOST_DISK_LOW`, `SYNCODE_QUEUE_FULL`. Studio hiện các lỗi này thành thông báo dễ hiểu kèm hành động gợi ý (xoá/clean app cũ).

### 3.3 Thanh hành động của editor (ADR-0054)

```
[✓ Verify] [▶ Simulate] │ [⚙ SynCode ●] [▶ Run] [■ Stop] │ [</> Open IDE] [⇩ Export]     App: Hazard (C++ · v4.0) ▾   ● Building 3/6
```

- Nhóm theo quy trình: **Kiểm tra** (Verify, Simulate) │ **Sinh & chạy** (SynCode, Run, Stop) │ **Mở/xuất**.
- Mỗi nút có icon + nhãn. Khi chạy: spinner thay icon, `aria-busy`, không bấm lặp được. Khi xong: dấu ✓ xanh (hoặc ✕ đỏ) 3 giây. Nút **hành động kế tiếp hợp lý** dùng kiểu `primary`: SynCode khi chưa có bản build mới, Run khi đã có.
- **Chip app đích:** tên app, ngôn ngữ, VSS; menu đổi app hoặc "Tạo app cho workflow này".
- **Pill trạng thái:** "Verified ✓" / "Simulating…" / "Building · bước 3/6" / "Running 00:42" / lỗi cuối cùng (bấm vào mở Build log hoặc Problems).
- Lý do vô hiệu hiện như dòng gợi ý dưới thanh (vd. "Chưa có app: bấm SynCode để tạo"), không chỉ trong tooltip.
- Giữ nguyên `data-sv-action` (E2E dựa vào đó).

### 3.4 UI tập trung vào toolchain (ADR-0054 §Focus)

- Sidebar còn: Search, **Vehicle apps**, **System status**, Workflows, Help, Settings.
- Ẩn và redirect Tables, Files, Knowledge base, Logs (thêm vào `hidden-routes.ts`).
- Settings còn: General, Teammates/Organization, Secrets, Recently deleted, Admin. Ẩn Billing, Custom tools, MCP tools, API keys, MCP servers, BYOK, Credential sets.
- Trợ lý AI giữ nguyên (đề xuất WorkflowPatch, ADR-0030).
- Chỉ ẩn bằng cấu hình (một danh sách duy nhất), không xoá file Sim, để diff upstream nhỏ (ADR-0008). Xoá thật để cho đợt cleanup sau.

### 3.5 Block thể hiện logic bằng hình (ADR-0055)

- **Câu tóm tắt** trên đầu mỗi block xe, sinh từ props bằng một hàm thuần cho mỗi loại, có test:
  - `On signal changed`: "Khi **Vehicle.Speed** đổi (bất kỳ)" / "Khi Speed vượt lên 120";
  - `Stable for`: "Nếu `speed > 120` giữ **2 s**";
  - `Set actuator`: "Đặt **Hazard.IsSignaling = true**";
  - `If`: "Nếu `<cond>`";
  - `HMI notify`: "⚠ HMI: Overspeed".
  Các dòng key/value giữ bên dưới, thu gọn.
- **Màu và hình theo loại:** trigger (viền trái đậm, hình "mũ"), điều kiện/rẽ nhánh, hành động lên xe (actuator), giao tiếp (MQTT/HMI), trạng thái (biến, bộ lọc, máy trạng thái). Dùng token có sẵn và icon `blocks/vehicle/icons.ts`.
- **Nhãn cổng và nhãn cạnh:** nhãn ngắn và màu cho cổng `then/else/stable/broken/timeout/error`. Cạnh hiện nhãn ở giữa (vd. "đúng", "sai", "ổn định 2 s", "lỗi"), màu theo nhánh.
- **Luồng dữ liệu:** chip "dùng: speedchanged.value". Rê chuột lên chip thì làm nổi block nguồn. Tham chiếu tới block không đứng trước nó (không dominate) đã bị lint báo `DATA_REF_NOT_DOMINATING`.
- **Không đổi ngữ nghĩa:** chỉ thay đổi phần hiển thị; WorkflowGraph/IR/code không đổi. Bằng chứng: golden graph-adapter, golden IR và conformance không đổi byte nào.

## 4. Kiểm thử (nhiều khía cạnh)

| Khía cạnh | Kiểm thử |
|---|---|
| Vòng đời | Unit: workspace delete/repair/clean (đường dẫn an toàn, thư mục khác không bị chạm), toolchain dọn cache, orchestrator delete (409 khi đang SynCode, dừng run), cascade DB. E2E: tạo → SynCode → Delete → thư mục mất. |
| Quota/ngưỡng | Unit: vượt quota ⇒ `APP_QUOTA_EXCEEDED`; giả lập đĩa trống < high ⇒ chặn tạo, < flood ⇒ chặn SynCode; hàng đợi gộp và 429. Gate trên stack: tạo tới quota, Clean/Delete trả lại dung lượng (đo `du`). |
| Thu hồi | Unit với đồng hồ giả: app nhàn rỗi > N ngày ⇒ build bị xoá, mã nguồn còn; failed > N ngày ⇒ xoá; đối chiếu rác xoá đúng app mồ côi, không xoá app hợp lệ. |
| UI | Vitest: trạng thái nút (idle/busy/done/error), chọn hành động primary, câu tóm tắt từng loại block (bảng đầu vào → câu), nhãn cạnh theo handle. E2E: hiện spinner khi SynCode; sidebar không còn mục ẩn; URL ẩn redirect. |
| Không hồi quy | Golden graph-adapter + IR + conformance + parity giữ nguyên; toàn bộ E2E hiện có; live smoke. |
| Tài nguyên máy dev | Mọi type-check/test nặng của studio chạy trên CI; local chỉ chạy test module nhỏ và biome theo file. |

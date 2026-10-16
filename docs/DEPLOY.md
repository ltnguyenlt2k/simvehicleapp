# Triển khai SimVehicleApp: image dựng sẵn cho máy cấu hình thấp

Dùng tài liệu này khi cài SimVehicleApp lên một máy chỉ để **chạy**, không để phát triển: laptop yếu, VM nhỏ, máy demo.
Cách này tải image đã build sẵn từ GitHub Release và không build gì trên máy. Thiết kế chi tiết:
[ADR-0051](../analysis/adr/ADR-0051-prebuilt-images-low-spec-deploy.md).

## 1. Cấu hình cần có (số đo 2026-10-13)

| | Tối thiểu | Ghi chú |
|---|---|---|
| CPU | 2 vCPU x86-64 | Build app C++ dùng `SV_BUILD_JOBS` job song song |
| RAM | **4 GB** | Đo: rảnh ~0,9 GB; peak 1,84 GB khi build app C++ (toolchain 893 MB). Phần còn lại cho hệ điều hành, Docker và trình duyệt |
| Đĩa | **15 GB trống** | Image core + studio + cpp sau khi load: ~6,5 GB; tải về ~1,9 GB (xoá ngay sau khi load). Mỗi project thêm ~140 MB (thư mục build) + ~4 MB cache Velocitas |
| Phần mềm | Docker Engine + Compose v2, `git`, `gh` (đã `gh auth login`, repo đang private), `zstd`, `python3` | |

Thêm backend tuỳ chọn:
- **Python** (`COMPOSE_PROFILES=python`): tải thêm ~1,05 GB, chiếm thêm ~2,9 GB đĩa.
- **Rust** (`rust`): tải thêm ~0,57 GB, chiếm thêm ~2,2 GB đĩa.

Số đo RAM là trên máy dev (WSL, 11 GB). "4 GB" là con số suy ra từ peak đo được; chưa chạy thử trên một máy 4 GB thật.

## 2. Cài đặt

```bash
git clone https://github.com/Blinkthor/sim-vehicle-app && cd sim-vehicle-app
git checkout <tag>            # tag của release có image, ví dụ baseline-2026-10-13.1
scripts/sv init               # tạo .env, sinh secret
# máy yếu: thêm SV_BUILD_JOBS=2 vào .env (app C++ build tối đa 2 job song song)
scripts/sv pull <tag>         # tải images-*.tar.zst, kiểm sha256, docker load; ghi SV_PREBUILT=<tag> vào .env
scripts/sv up                 # khởi động; có SV_PREBUILT nên chạy với --no-build, không build gì
scripts/sv smoke              # tuỳ chọn: tạo project → build → chạy app ↔ databroker/MQTT
```

Mở studio tại `SV_STUDIO_URL` (mặc định http://localhost:3000). Bỏ `<tag>` ở `sv pull` thì lệnh lấy release mới nhất
có image. `--groups core,studio,cpp,python` chọn nhóm cụ thể.

## 3. Tiết kiệm tài nguyên

| Biến (`.env`) | Tác dụng |
|---|---|
| `SV_BUILD_JOBS=2` | Giới hạn số job compile khi build app C++. Để trống thì dùng mặc định Ninja (CPU + 2), dễ OOM nếu máy nhiều nhân mà ít RAM |
| `SV_CARGO_JOBS=2` | Tương tự cho Rust (mặc định 2) |
| `COMPOSE_PROFILES=` (trống) | Chỉ chạy backend C++. Thêm `python`/`rust` khi cần |
| `SV_AI_PROVIDER=fake` | Trợ lý AI không gọi model (không tốn RAM/mạng). Dùng provider cloud khi có key; **không** chạy LLM local trên máy yếu |
| `SV_STUDIO_PORT`, `SV_IDE_PORT` | Đổi cổng nếu máy đã dùng 3000/8080 (nhớ đổi cả `SV_STUDIO_URL`, `SV_IDE_PUBLIC_URL`) |

Không cần dọn cache Velocitas theo từng project: các project dùng chung venv Python của seed (ADR-0051 §5).

## 4. Dung lượng & quota (ADR-0053)

Mỗi vehicle app chiếm khoảng 140 MB: phần lớn là thư mục build; cache Velocitas của app chỉ vài MB. Nhiều người dùng
tạo nhiều app thì đĩa đầy dần. Stack tự giới hạn và tự dọn; quản trị viên chỉ cần chọn ngưỡng.

**Giới hạn** (đặt trong `.env`, có sẵn dòng mẫu trong `.env.example`):

| Biến | Mặc định | Khi chạm ngưỡng |
|---|---|---|
| `SV_MAX_APPS_PER_WORKSPACE` | 10 | Không tạo thêm app trong workspace (409 `APP_QUOTA_EXCEEDED`) |
| `SV_MAX_APPS_TOTAL` | 100 | Không tạo thêm app trên cả máy |
| `SV_MAX_WORKFLOWS_PER_APP` | 20 | Không gán thêm workflow vào một app |
| `SV_MAX_QUEUED_GENERATIONS` | 20 | SynCode báo "thử lại sau ít phút" (429 `SYNCODE_QUEUE_FULL`). Mỗi app chỉ có 1 SynCode chờ; SynCode mới thay SynCode cũ |
| `SV_DISK_LOW_GB` | 10 | Đĩa còn dưới mức này: chỉ cảnh báo trên trang Vehicle apps và System status |
| `SV_DISK_HIGH_GB` | 5 | Không tạo app mới, không repair (507 `HOST_DISK_LOW`) |
| `SV_DISK_FLOOD_GB` | 2 | Tạm dừng SynCode. Run và các thao tác dọn vẫn chạy |

Không đo được đĩa thì hệ thống cho qua và ghi log: người dùng không bị chặn chỉ vì phép đo lỗi.

**Run nhiều người cùng lúc** (ADR-0057, M17-T04). Mặc định `SV_RUN_SANDBOX=0`: cả máy chỉ một run trên databroker dùng chung.
Đặt `SV_RUN_SANDBOX=1` để mỗi run có databroker riêng (tiến trình trong container toolchain, cổng trong `SV_SANDBOX_PORTS`,
mặc định 56000–56199). Theo số đo spike, mỗi run tốn ~7 MB cho databroker và ~13 MB cho app.

> Giao diện Live/inject theo từng sandbox làm ở M17-T05. Trước khi xong T05, giữ `SV_RUN_SANDBOX=0`.

| Biến | Mặc định | Khi chạm ngưỡng |
|---|---|---|
| `SV_MAX_RUNS_PER_USER` | 2 | Người dùng không chạy thêm app (409 `RUN_QUOTA_EXCEEDED`, scope `user`) |
| `SV_MAX_RUNS_TOTAL` | 20 | Cả máy không chạy thêm app (scope `host`); cũng là trần `SV_MAX_RUNS` của mỗi toolchain |
| `SV_RUN_MAX_MINUTES` | 30 | Run tự dừng (`stopReason: expired`); `0` = không giới hạn |
| `SV_RUN_MAX_EXTENSIONS` | 3 | Extend, mỗi lần thêm `SV_RUN_MAX_MINUTES`, không quá số lần này |

**Tự dọn** (orchestrator, mỗi `SV_SWEEP_INTERVAL_MIN` = 60 phút):
- App `failed` cũ hơn `SV_FAILED_TTL_DAYS` (7 ngày) bị xoá.
- App không SynCode/Run trong `SV_IDLE_CLEAN_DAYS` (14 ngày) bị **clean**: xoá thư mục build, giữ mã nguồn. Lần SynCode
  sau tự cài lại dependency và build lại (lâu hơn bình thường).
- Cache Velocitas của app không còn tồn tại bị xoá.
- App đang chạy hoặc đang có SynCode được bỏ qua.
- `SV_KEEP_GENERATIONS` (10): số bản sinh mã cũ giữ lại cho mỗi app. `SV_CCACHE_MAX` (2G): trần cache biên dịch C++.

Đặt `0` cho `SV_FAILED_TTL_DAYS` hoặc `SV_IDLE_CLEAN_DAYS` để tắt việc dọn tương ứng.

**Người dùng tự dọn:** trang **Vehicle apps** hiện dung lượng từng app và có các nút Clean / Delete / Repair. Xoá
workspace thì các app của workspace đó bị xoá ở lần kế tiếp có người (bất kỳ workspace nào) mở trang Vehicle apps;
việc đối soát này chạy tối đa 1 lần/giờ.

**Quản trị viên dọn:** `scripts/sv apps prune` liệt kê app không ai dùng (app gate/test không thuộc workspace nào, app
của workspace đã xoá, thư mục không có app) và dung lượng sẽ thu hồi. Lệnh chỉ in ra, chưa xoá gì; thêm `--apply` để
xoá. `--e2e` thêm app của user Playwright, `--failed` thêm app khởi tạo lỗi. `scripts/sv apps list` liệt kê mọi app
kèm dung lượng và chủ sở hữu.

**Đặt dữ liệu trên phân vùng riêng (khuyến nghị cho máy dùng chung).** Ngưỡng đĩa đo hệ thống file chứa volume
workspace, tức thư mục data-root của Docker (mặc định `/var/lib/docker`). Đặt `data-root` trong
`/etc/docker/daemon.json` lên một ổ hoặc phân vùng riêng thì app đầy đĩa cũng không làm đầy ổ hệ điều hành.

**Cảnh báo theo metrics** (`GET /metrics` của orchestrator, xem [OPERATIONS](dev/OPERATIONS.md) §5):
`sv_workspace_free_bytes` (đĩa còn trống), `sv_apps_total` (số app), `sv_generation_queue_length` (hàng đợi SynCode),
`sv_reclaimed_bytes_total` (dung lượng sweeper đã thu hồi). Ví dụ cảnh báo: `sv_workspace_free_bytes < 10e9`.

## 5. Cập nhật lên release mới

```bash
git fetch --tags && git checkout <tag-mới>
scripts/sv pull <tag-mới>
scripts/sv up                 # tạo lại container với image mới; dữ liệu (volume) giữ nguyên
docker image prune -f         # xoá image cũ không còn dùng
```

**Không** chạy `scripts/sv down -v`: lệnh này xoá volume, tức mất database studio và mọi project.

## 6. Phát hành image (dành cho maintainer)

1. Chọn một commit có CI xanh, tạo release:
   `gh release create <tag> --target <sha> --prerelease --notes-file …`.
2. Workflow **release-images** tự chạy, build các nhóm `core`, `studio`, `cpp`, `python`, `rust` từ đúng tag, rồi đính
   `images-<nhóm>.tar.zst` + `.sha256` vào release. Nhóm cpp mất lâu nhất vì phải build toolchain.
3. Chạy lại một nhóm khi cần: Actions → release-images → Run workflow (`tag`, `groups`).
4. Thêm image mới vào compose thì phải thêm vào `deploy/image-groups.txt`. CI (`scripts/ci/image_groups.py`) sẽ fail
   nếu thiếu.

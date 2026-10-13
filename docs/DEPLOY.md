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

## 4. Cập nhật lên release mới

```bash
git fetch --tags && git checkout <tag-mới>
scripts/sv pull <tag-mới>
scripts/sv up                 # tạo lại container với image mới; dữ liệu (volume) giữ nguyên
docker image prune -f         # xoá image cũ không còn dùng
```

**Không** chạy `scripts/sv down -v`: lệnh này xoá volume, tức mất database studio và mọi project.

## 5. Phát hành image (dành cho maintainer)

1. Chọn một commit có CI xanh, tạo release:
   `gh release create <tag> --target <sha> --prerelease --notes-file …`.
2. Workflow **release-images** tự chạy, build các nhóm `core`, `studio`, `cpp`, `python`, `rust` từ đúng tag, rồi đính
   `images-<nhóm>.tar.zst` + `.sha256` vào release. Nhóm cpp mất lâu nhất vì phải build toolchain.
3. Chạy lại một nhóm khi cần: Actions → release-images → Run workflow (`tag`, `groups`).
4. Thêm image mới vào compose thì phải thêm vào `deploy/image-groups.txt`. CI (`scripts/ci/image_groups.py`) sẽ fail
   nếu thiếu.

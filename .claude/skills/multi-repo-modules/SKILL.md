---
name: multi-repo-modules
description: Create or change SimVehicleApp module boundaries and contracts-only dependencies, or manage release-time submodules and locks.
---

# Module độc lập

Nguồn: `analysis/02-layers-and-modules.md` (ma trận §4), ADR-0002, ADR-0007, **ADR-0009** (dev), spec tương ứng trong `analysis/modules/`.

## Dev hiện tại
- `modules/<name>/` là thư mục thường trong một repo; không tạo nested `.git`, submodule, lock hay workflow nhiều PR cho một sửa đổi dev.
- Module tự chứa build context, compose fragment, source/test. Chỉ phụ thuộc package contracts; không import code module khác hoặc dùng build context ra ngoài module. Runtime calls theo ma trận §4.
- Khi tạo module, theo task: README, CONTRACT, instruction local, Dockerfile, health/version, test/CI thích hợp; root `docker-compose.yml` include fragment. Fragment khai báo network/volume cần dùng để validate độc lập.
- Service contract/kiến trúc đổi ⇒ ADR và version/contract test đồng bộ. Commit nếu được yêu cầu dùng scope module + task ID. Không tự commit/push/merge từ việc đọc skill.

## Release v1.0
Chỉ khi task release yêu cầu: theo ADR-0009 split bằng subtree rồi submodule + lock theo ADR-0002. Kiểm script thật trước khi gọi: `scripts/modules.sh`, `scripts/lock-verify.sh`, `scripts/release-split.sh` là mục tiêu release, chưa có ở baseline dev. Không chạy hay tạo chúng chỉ để làm một task dev. Bump lock sau module release/merge và verify nếu workflow release đã tồn tại.

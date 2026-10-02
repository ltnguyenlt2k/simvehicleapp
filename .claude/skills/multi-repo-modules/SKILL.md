---
name: multi-repo-modules
description: Use when creating a SimVehicleApp sub-repo, editing code inside modules/*, adding a dependency between modules, bumping simvehicleapp.lock.yaml, or checking submodule status. Enforces the independent-repo + contracts-only dependency rules.
---

# Làm việc với repo con của SimVehicleApp

> **Giai đoạn dev (hiện tại, ADR-0009):** một repo, mỗi module là thư mục `modules/<repo>/` độc lập + compose fragment riêng; root `docker-compose.yml` chỉ include. Phần "submodule/lock" bên dưới áp dụng từ **release v1.0** (tách bằng `git subtree split`).

Tham chiếu: `analysis/02-layers-and-modules.md`, `analysis/adr/ADR-0002-*.md`, `analysis/modules/*.md`.

## Luật
- Dev phase: mỗi `modules/<repo>` là thư mục có ranh giới như repo thật (README, Dockerfile, compose fragment riêng, test riêng); commit message có prefix module (`velocitas-stack: …`) để `git subtree split` sạch. Release: thành repo git độc lập, meta-repo chỉ bump SHA.
- Phụ thuộc hợp lệ duy nhất giữa module: package `@simvehicleapp/contracts` (npm) / `simvehicleapp-contracts` (pypi). Không `import` đường dẫn tương đối sang module khác, không workspace link trong code release.
- Ma trận được phép gọi runtime (HTTP) ở `02 §4`. Ví dụ: studio **không** gọi codegen/toolchain; codegen **không** gọi gì.

## Tạo repo con mới
1. Copy "module template" (README, CONTRACT.md, AGENTS.md, CLAUDE.md→@AGENTS.md, CHANGELOG, LICENSE Apache-2.0, NOTICE, VERSION, Dockerfile với HEALTHCHECK `/healthz`, CI lint/test/contract/license/image).
2. Implement `/healthz` và `/version` (`{name, version, commit, contracts}`) bằng `service-kit` từ contracts.
3. `git submodule add <url> modules/<repo>`; thêm mục vào `simvehicleapp.lock.yaml`; thêm service vào `compose/*.yaml` (network `internal`, không publish port trừ khi là UI).
4. Viết `analysis/modules/<repo>.md` (hoặc cập nhật) + ADR nếu là tầng/khối mới.

## Bump lock
```bash
scripts/modules.sh status              # SHA hiện tại vs lock
scripts/modules.sh bump <module>       # cập nhật SHA + version + image digest trong lock
scripts/lock-verify.sh                 # phải PASS trước khi mở PR meta-repo
```
## Dev mode (M0–M3)
`scripts/modules.sh link` để dùng contracts local khi đang thay đổi schema; **luôn** `unlink` trước khi commit.

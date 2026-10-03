# Module: `simvehicleapp` (meta-repo)

**Tầng:** hạ tầng/tích hợp · **ADR:** 0002, 0005, 0007, 0009 · **Milestone:** M0 (tạo), M11 (split repo + lock)

## Trách nhiệm
Dev: một repo chứa các thư mục module, root `docker-compose.yml` include fragment từng module, `.env.example`, tài liệu và scripts vận hành. Code sản phẩm thuộc module sở hữu. Release: tách repo/submodule và khoá SHA/image trong `simvehicleapp.lock.yaml` theo ADR-0009.

## Cấu trúc
Xem [02 §5](../02-layers-and-modules.md#5-cấu-trúc-meta-repo-simvehicleapp).

## Scripts

Hiện có `scripts/sv build|up|down|smoke|reset-caches`; `smoke` gọi `spikes/smoke.sh` cho M0. Bảng dưới là thiết kế đích: script submodule/lock/bootstrap thuộc M11-T10; smoke GW-A thuộc M8-T10. Kiểm script tồn tại trước khi gọi.
| Script | Việc |
|---|---|
| `scripts/bootstrap.sh` | kiểm tra docker/compose version → `git submodule update --init` → `lock-verify` → build image theo thứ tự (contracts → toolchain → ide → phần còn lại) → `compose up -d` → `smoke.sh` |
| `scripts/modules.sh status\|bump <m>\|link\|unlink` | quản lý submodule & lock |
| `scripts/lock-verify.sh` | SHA submodule == lock; contract ranges giao nhau; image tags tồn tại |
| `scripts/gen-secrets.sh` | sinh secret cho `.env` |
| `scripts/smoke.sh` | healthz + GW-A end-to-end rút gọn |
| `scripts/license/scan.sh` | quét license mọi submodule |

## Test
`tests/e2e/` (Playwright + API): tutorial flow, GW-A..G, IDE open, export build, AI patch (LLM giả).

## CI
Dev: CI root M00-T08 kiểm license theo phase, contract-only-deps và compose lint; thêm test module/tích hợp theo milestone. Release mới có lock-verify. Nightly full E2E + parity + compile khi pipeline đã hiện thực. Hiện chưa có CI root; xem [ROADMAP](../../docs/ROADMAP.md).

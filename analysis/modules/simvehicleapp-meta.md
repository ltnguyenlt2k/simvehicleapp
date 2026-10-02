# Module: `simvehicleapp` (meta-repo)

**Tầng:** hạ tầng/tích hợp · **ADR:** 0002, 0005, 0007 · **Milestone:** M0 (tạo), mọi M (bump lock)

## Trách nhiệm
Gom mọi repo con (submodule), khoá version (`simvehicleapp.lock.yaml`), định nghĩa compose, `.env.example`, tài liệu hệ thống (docs, analysis, ADR Accepted), E2E xuyên module, scripts vận hành. **Không chứa code sản phẩm.**

## Cấu trúc
Xem [02 §5](../02-layers-and-modules.md#5-cấu-trúc-meta-repo-simvehicleapp).

## Scripts
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
PR: lock-verify, compose config lint (không docker.sock, bind localhost), smoke. Nightly: full E2E + parity + compile.

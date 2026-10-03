# M11 — Hardening, Parity, E2E, Cleanup → Release v1.0

**Mục tiêu:** đạt tiêu chí "Product-ready v1.0" ([13 §5](../13-implementation-roadmap.md#5-định-nghĩa-product-ready-v10-exit-m11)).
**ADR:** 0032, 0033, 0042 · **Phụ thuộc:** M8, M9, M10 · Master Plan Phase 22, 26–28

## Tasks
| ID | Task | Test |
|---|---|---|
| M11-T01 | Parity P3 (binary thật) cho GW-A..G, nightly dashboard | parity 100% |
| M11-T02 | Playwright E2E: tutorial flow, 7 golden, IDE, export, AI (LLM giả) | nightly xanh 3 ngày |
| M11-T03 | Cleanup Sim đợt 3: xoá block/tools/connectors/executor handlers/triggers không dùng; dependency thừa; knip | bundle size & build time giảm (đo) |
| M11-T04 | Auth/tenancy BFF permissions (ADR-0032) | tests |
| M11-T05 | Observability: `/metrics`, log correlation, System status page (ADR-0033) | |
| M11-T06 | Security checklist [14 §5](../14-testing-strategy.md#5-security-checklist) + fuzz + osv-scanner | report |
| M11-T07 | Performance: validate/compile/simulate/SynCode incremental benchmark | NFR-02 |
| M11-T08 | Docs: user guide (tutorial, block reference sinh từ BlockSpec semantics.md), dev docs (BLOCK_SDK, ADD_NEW_BLOCK, IR_SPEC, DIAGNOSTICS_CATALOG, RUNTIME_API, BACKEND_PLUGIN, OPERATIONS) | review |
| M11-T09 | Usability test 5 người (tutorial < 10 phút) | report |
| M11-T10 | Release theo ADR-0009: nhận M00-T03; viết `scripts/release-split.sh`, `scripts/modules.sh`, `scripts/lock-verify.sh`, `scripts/bootstrap.sh`; tách module giữ lịch sử, tag repo, lock v1.0.0, images publish, CHANGELOG | dry-run split; lock-verify PASS và từ chối SHA sai; clone sạch + bootstrap + smoke |

## Gate
Checklist v1.0 đầy đủ, ký bởi lead.

Report phải dẫn kết quả T01–T10 và từng hàng [bằng chứng chuỗi sản phẩm](../13-implementation-roadmap.md#bằng-chứng-đóng-chuỗi-sản-phẩm).

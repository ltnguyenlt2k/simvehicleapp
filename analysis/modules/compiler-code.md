# Module family: `compiler-code-<lang>` (cpp · python · rust)

**Tầng:** L4 · **ADR:** 0020, 0021, 0022, 0040, 0041 · **Milestone:** M6 (cpp), M12 (python), M13 (rust)
**Containers:** `codegen-cpp` :4110, `codegen-python` :4120, `codegen-rust` :4130 (network `internal`, read-only FS)

Chi tiết cấu trúc repo, `backend.yaml`, API, runtime: [07-codegen-backends](../07-codegen-backends.md).

## Ranh giới
| Được | Không được |
|---|---|
| Đọc IR, sinh file trong ownedRoots, trả manifest fragment, source map | Ghi đĩa ngoài tmp, gọi mạng, gọi LLM, biết về Sim/graph |
| Chứa runtime library ngôn ngữ + test riêng | Phụ thuộc code của core/orchestrator |
| Khai báo toolchain id cần dùng | Tự build (việc của velocitas-stack) |

## Kiểm thử bắt buộc
unit emitters · golden GW (diff 0) · determinism · runtime unit + conformance · fuzz string/identifier · compile (nightly, qua toolchain image).

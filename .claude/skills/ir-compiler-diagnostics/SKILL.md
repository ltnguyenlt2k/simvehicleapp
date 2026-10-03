---
name: ir-compiler-diagnostics
description: Implement Graph-to-IR compiler stages, expressions, type and unit checks, canonicalization or public diagnostics.
---

# Compiler, IR & diagnostics

Tham chiếu: `analysis/06-ir-and-compiler.md`, ADR-0013/0014/0015/0016/0018.

## Bất biến
- Compiler thuần: I/O duy nhất là `VehicleModelProvider` (catalog) và `CapabilitiesProvider` (backend) — inject được trong test.
- IR không chứa timestamp; `irHash = sha256(canonical(IR \ irHash))`; id tất định (DFS từ trigger, hoà theo blockId).
- `$ref` chỉ tới output dominate; logic/math inline thành `$expr`.
- Không cast thu hẹp ngầm; khác unit cùng dimension ⇒ chèn `unit.convert` (`src.inserted=true`).
- Mã diagnostic: chỉ thêm, không đổi/xoá; message theo `code`+`data` (i18n).
- **Mảng (`T[]`, ADR-0018):** giá trị mảng không được dùng trực tiếp ở context vô hướng — bắt buộc qua `array.len`/`array.at`/`array.contains`. Mảng luôn read-only (không actuator nào kiểu mảng trong VSS thật) ⇒ không có opcode ghi mảng.
- **int64/uint64 (ADR-0018):** mã hoá chuỗi decimal trong mọi JSON (WorkflowGraph/IR/Scenario) để tránh mất chính xác qua `Number.MAX_SAFE_INTEGER`; TS dùng `BigInt`, C++ dùng `int64_t`/`uint64_t` native.

## Pipeline
S0 parse/limits → S1 structural → S2 block config (+migration) → S3 vehicle model → S4 types → S5 units → S6 control flow (cycle, dominance, reachability, loop guard) → S7 backend capability → IR builder → canonicalize/hash. Modes: `lint` (S0–S3 + một phần S6), `verify`, `build`.

## Thêm diagnostic mới
1. Thêm vào `diagnostics-catalog.v1.json` (contracts) với severity/stage/i18n key.
2. Emit ở đúng stage với `blockId` + `field`.
3. Test "cố ý sai" → đúng mã.
4. Regenerate `docs/DIAGNOSTICS_CATALOG.md`.

## Kiểm tra
Golden IR GW-A..G diff 0; determinism (chạy 2 lần); JSON Schema validate mọi IR; perf 200 block < 300 ms.

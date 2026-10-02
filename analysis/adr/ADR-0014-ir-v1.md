# ADR-0014: Canonical IR v1 (control graph + expression trees, hashed, versioned)

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L1
- **Related:** FR-WF-03, NFR-01; Master Plan Part 6; [06 §2](../06-ir-and-compiler.md#2-ir-v1--cấu-trúc)

## Context
Master Plan 6.2 đề xuất IR có `nodes` + `edges(kind: data|control)` và `metadata.generatedAt`. Phân tích thêm:
- `generatedAt` trong IR phá tính tất định của `irHash`.
- Data edges tách rời khiến backend phải tự dựng lại biểu thức; mô hình tham chiếu (ADR-0013) cho phép biểu diễn data bằng **cây biểu thức** gọn hơn.
- Backend cần biết trước danh sách signal/topic/state để sinh khai báo & AppManifest.

## Decision
1. IR v1 gồm: header (`irVersion, compilerVersion, workflowId, workflowRevision, name, modelHash, sourceGraphHash, irHash`), `signals[]`, `topics[]`, `state[]`, `triggers[]` (có `entry`, `concurrency`), `nodes[]` (có `opcode`, `args` là expression tree, `next` theo handle, `body` cho container, `src`).
2. **Không** có timestamp trong IR; thời gian sinh nằm ở Generation record.
3. Canonicalization: id đánh lại tất định (DFS từ trigger theo thứ tự `blockId`), key sort, số canonical, `irHash = sha256(canonical(IR \ {irHash}))`.
4. JSON Schema `ir.v1.schema.json` trong contracts; mọi IR sinh ra phải validate trong CI.
5. Logic/math inline vào expression tree của node tiêu thụ; node riêng chỉ cho thao tác có side-effect/yield/control.
6. Node do compiler chèn có `src.inserted=true, src.reason`.
7. Semver: thêm opcode = minor; đổi nghĩa/field bắt buộc = major.

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| IR = graph Sim nguyên bản | Buộc backend hiểu Sim; trái nguyên tắc 3.2 |
| IR dạng SSA/3-address code | Quá thấp cho người đọc/diff; backend C++ phải dựng lại cấu trúc |
| Giữ data edges | Dư thừa với tham chiếu; khó emit |

## Consequences
+ Backend đơn giản, IR đọc/diff được, hash ổn định. − Khi thêm data edges thật (nếu cần tương lai) phải major bump.

## Implementation
Schema + TS types + validator + canonicalizer + golden IR GW-A..G (M4).

## Verification
Golden IR diff = 0; determinism test (2 lần, 2 OS); schema validate tất cả IR.

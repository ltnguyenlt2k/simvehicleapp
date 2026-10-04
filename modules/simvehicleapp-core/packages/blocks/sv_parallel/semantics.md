# `sv_parallel` v1 — Run in parallel (P1, container)
Nguồn: [05 §2.5–2.7](../../../../../analysis/05-blocks-and-execution-model.md#25-flow-control), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md).

- **Opcode:** `control.parallel` (+ join); container subflow `parallel` của Sim. Handle vào `target`; ra `parallel-start-source` (các nhánh) và `parallel-end-source` (sau join).
- **`join`:** `all` (mặc định, chờ mọi nhánh), `any` (nhánh đầu xong thì đi tiếp, huỷ các nhánh còn lại), `none` (đi tiếp ngay, nhánh chạy nền).
- "Song song" là xen kẽ trên **một strand** (ADR-0012 §2), không đa luồng. Không có nhánh ⇒ `PARALLEL_BRANCH_EMPTY`.

# `sv_on_timer` v1 — Every …
Nguồn: [05 §2](../../../../../analysis/05-blocks-and-execution-model.md#2-catalog-block-chi-tiết-v1), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md), [ADR-0013](../../../../../analysis/adr/ADR-0013-dataflow-and-expression-language.md).

- **Loại:** trigger; opcode `event.timer`; handle ra `source`.
- **`intervalMs`:** chu kỳ, ≥ 10 ms (bắt buộc). **`initialDelayMs`:** trễ lần đầu, mặc định 0.
- **`concurrency`:** mặc định `ignore` (bỏ tick khi run trước chưa xong); `restart`/`queue`/`parallel` theo 05 §3.2.
- **Outputs:** `tick` (đếm từ 1, uint32), `timestamp` (ms, đồng hồ đơn điệu; simulator dùng virtual clock).
- **Thời gian:** tick theo lịch cố định (không trôi theo thời gian chạy run); tick trễ quá một chu kỳ ⇒ bỏ, không dồn.

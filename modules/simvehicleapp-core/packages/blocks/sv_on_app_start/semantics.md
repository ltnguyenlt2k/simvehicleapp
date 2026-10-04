# `sv_on_app_start` v1 — When app starts
Nguồn: [05 §2](../../../../../analysis/05-blocks-and-execution-model.md#2-catalog-block-chi-tiết-v1), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md), [ADR-0013](../../../../../analysis/adr/ADR-0013-dataflow-and-expression-language.md).

- **Loại:** trigger; opcode `event.app_start`; không prop, không output; handle ra `source`.
- **Ngữ nghĩa:** bắn **đúng một lần** khi app vehicle khởi động xong (đã kết nối databroker, attribute đã đọc cache). Không có chính sách đồng thời (chỉ một lần).
- **Thay vai trò block Start của Sim** cho workflow vehicle (ADR-0012 Notes 2026-10-04).
- **Edge case:** nhiều block `sv_on_app_start` trong một workflow ⇒ mỗi block tạo một run riêng, thứ tự theo `seq` (ADR-0012 §5).

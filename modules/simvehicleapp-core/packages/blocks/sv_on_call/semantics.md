# sv_on_call — When called (ADR-0063)

- **Vai trò:** trigger của một **workflow hàm**. Opcode khai báo `event.call`, nhưng không bao giờ vào IR: khi một workflow khác gọi hàm này (`sv_call_workflow`), compiler thay lời gọi bằng thân hàm (`expandCalls`) trước lint.
- **Props:** không có. **Outputs:** không có. Tham số và kết quả là **biến workflow** của hàm: biến được gán qua `args` của lời gọi, biến `result` là kết quả.
- **Handle ra:** `source` — block đầu tiên của thân hàm.
- **Edge cases:**
  - Workflow hàm mở trong editor: cảnh báo `SUBWORKFLOW_ONLY_CALLED` (nó chỉ chạy khi được gọi), thân hàm vẫn được kiểm như workflow thường. Compile riêng (SynCode, Simulate) không sinh IR.
  - Hai trigger `sv_on_call` trong một workflow ⇒ lời gọi báo `SUBWORKFLOW_NOT_FOUND`.
- **Đồng thời:** theo trigger của workflow gọi (thân hàm chạy trong run của người gọi).

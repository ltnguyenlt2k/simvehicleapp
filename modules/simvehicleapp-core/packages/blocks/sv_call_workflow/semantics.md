# sv_call_workflow — Call workflow (ADR-0063)

- **Vai trò:** chạy thân một **workflow hàm** (trigger `sv_on_call`) ngay tại chỗ, rồi đi tiếp `source`. Opcode khai báo `control.call`; compiler **inline** lời gọi trước lint (`expandCalls`), nên IR, simulator và mọi backend chỉ thấy block thường.
- **Props:**
  - `workflowId`: workflow hàm, cùng workspace;
  - `args`: danh sách `{name, value}`. `name` là biến của hàm, `value` là biểu thức của người gọi, tính trước khi vào thân hàm.
- **Output:** `value` — giá trị của biến `result` của hàm sau khi thân hàm chạy xong (kiểu của biến đó). Hàm không có `result` ⇒ không có `value`.
- **Handles:** vào `target`; ra `source`, khi thân hàm kết thúc ở mọi nhánh, trừ `error`.
- **Inline:**
  1. một `state.set` cho mỗi arg, theo thứ tự trong danh sách;
  2. các block của thân hàm, id `<id gọi>-<id>`, tên `<tên gọi>_<tên>`;
  3. biến của hàm đổi tên thành `<tên gọi>__<biến>` (trạng thái riêng cho mỗi chỗ gọi);
  4. một `state.get` mang tên block gọi đọc `result`.
- **Lỗi** (gắn vào block gọi):
  - `SUBWORKFLOW_NOT_FOUND`: không có workflow hàm, hoặc không phải hàm;
  - `SUBWORKFLOW_RECURSIVE`: gọi vòng;
  - `SUBWORKFLOW_TOO_DEEP`: lồng quá 4 cấp;
  - `SUBWORKFLOW_ARG_UNKNOWN`: arg không phải biến của hàm;
  - lỗi bên trong thân hàm được báo kèm tên hàm.
- **Tất định:** cùng graph và cùng các workflow hàm ⇒ cùng graph phẳng ⇒ cùng IR.

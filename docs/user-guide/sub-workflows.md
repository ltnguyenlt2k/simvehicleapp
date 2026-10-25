# Gọi một workflow từ workflow khác (sub-workflow)

> [ADR-0063](../../analysis/adr/ADR-0063-sub-workflow-inline-call.md), M21 D13.

Khi nhiều trigger hoặc nhiều workflow cần cùng một đoạn logic, ví dụ "kiểm tốc độ có nguy hiểm không", hãy viết đoạn đó **một lần** thành **workflow hàm**, rồi gọi nó bằng block **Call workflow**.

## 1. Viết workflow hàm
1. Tạo một workflow mới, đặt tên rõ ràng, ví dụ `Safety check`.
2. Kéo trigger **When called** vào canvas. Workflow hàm chỉ có trigger này.
3. Trong panel **Variables**, khai báo:
   - **tham số**: mỗi giá trị người gọi đưa vào, ví dụ `speed` (number);
   - **`result`** (tuỳ chọn): giá trị trả về, ví dụ boolean.
4. Viết thân hàm như workflow thường: **Get variable** `speed` ⇒ **If** `<spd.value> > 120` ⇒ **Set variable** `result = true` (nhánh *then*) hoặc `false` (nhánh *else*).

Workflow hàm không chạy một mình. Simulate hay SynCode nó báo `SUBWORKFLOW_ONLY_CALLED`.

## 2. Gọi nó
1. Trong workflow gọi, kéo block **Call workflow** vào sau trigger.
2. **Workflow**: chọn `Safety check`.
3. **Arguments**: mỗi dòng gồm tên biến của hàm và một biểu thức, ví dụ `speed` = `<whenspeedchanges1.value>`.
4. Block sau dùng kết quả: `<check.value>` (`check` là tên block gọi). Ví dụ **Set** `Hazard.IsSignaling` = `<check.value>`.

Simulate, Test, SynCode, Run và Export dùng được như workflow thường.

## Hoạt động thế nào
- **Inline lúc compile:** compiler chép thân hàm vào chỗ gọi. App sinh ra không có "hàm" riêng, và trên canvas mỗi workflow vẫn là một workflow. Trong trace và Flow, block của hàm có tên dạng `<tên block gọi>_<tên block>`.
- **Biến:**
  - biến là tham số được gán lại mỗi lần gọi;
  - biến khác của hàm giữ giá trị giữa các lần gọi;
  - mỗi chỗ gọi có bản riêng.
- **Lỗi bên trong hàm** hiện trên block **Call workflow**, mở đầu bằng `In <tên hàm>:`.

## Giới hạn
- Gọi lồng tối đa **4 cấp**, tối đa **16** workflow hàm.
- Không gọi vòng (A gọi B, B gọi A): báo `SUBWORKFLOW_RECURSIVE`.
- Workflow hàm phải cùng workspace, và bạn phải có quyền đọc nó.

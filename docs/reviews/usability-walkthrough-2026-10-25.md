# Cognitive walkthrough — tutorial "Overspeed warning" (thay cho usability test 5 người)

> M21 D5 (theo uỷ quyền PO 2026-10-25). **Đây không phải test với người thật.** Agent không tuyển được 5 người dùng; tài liệu này
> đi từng bước của [tutorial](../user-guide/tutorial.md) như một người mới, đối chiếu với code và E2E thật, và ghi chỗ dễ vấp.
> Đề xuất: làm test 5 người thật sau release v1.0, cùng kịch bản, đo thời gian và ghi lại chỗ người dùng hỏi.

## Phương pháp
Với mỗi bước, bốn câu hỏi của cognitive walkthrough:
1. Người dùng có biết phải làm gì để đạt mục tiêu bước này không?
2. Họ có thấy control cần dùng không?
3. Họ có nối được control đó với mục tiêu không?
4. Sau khi làm, phản hồi có cho thấy họ đang đi đúng không?

Nguồn đối chiếu:
- tutorial;
- E2E cùng kịch bản: `tutorial-live @live`, `m15-full-flow @live`, `m20-wasm-live @live`;
- source studio.

Số đo tự động: `tutorial-live` 1,1 phút (máy dev, cache ấm). Con số này không phải thời gian của người mới.

## Kết quả theo bước
| Bước | Đánh giá | Vấn đề | Xử lý |
|---|---|---|---|
| 1 Tài khoản | ✖ với một số tên tiếng Việt | Ô tên chỉ nhận chữ cái `\p{L}`. Tên gõ ở dạng tách dấu (NFD, ví dụ "Nguyễn" từ macOS hoặc một số bộ gõ) gồm chữ gốc + dấu kết hợp `\p{M}` ⇒ báo "Name can only contain letters…" dù người dùng chỉ gõ tên mình. | **Đã sửa:** nhận thêm `\p{M}` (`signup-form.tsx`). "C++", chữ số vẫn bị từ chối như trước. |
| 1 Create workflow | ✔ | Lệnh nằm trong Search (⌘K), người mới có thể không biết. Tutorial ghi rõ. | — |
| 2 Trigger | ✔ | Kéo một tín hiệu ra canvas thì mở menu chọn khối; phản hồi rõ (khối có tên). | — |
| 3 Stable for | ⚠ | Phải gõ biểu thức `<whenspeedchanges1.value> > 120`. Người mới không đoán được tên tham chiếu. | Đã có **Data from earlier blocks** (bấm để chèn); tutorial nhắc. Không đổi thêm. |
| 4 Set hazard | ✔ | Sensor không có Set ⇒ người dùng không chọn sai loại tín hiệu. Tab Problems chỉ lỗi và nhảy tới khối. | — |
| 5 Simulate | ✔ | Case Default mở sẵn; timeline cho thấy lệnh ghi lúc 4000 ms; **Generate tests** cho người lười nhập. | — |
| 6 SynCode | ⚠ | Lần đầu "Preparing app…" có thể vài phút (tạo project + build lần đầu): đây là rủi ro lớn nhất cho mục tiêu < 10 phút. Nút và build log cho thấy đang tiến triển. | Ghi rõ trong tutorial. Không đổi kiến trúc: cache build + image dựng sẵn (ADR-0051) đã là cách giảm thời gian. |
| 7 Run + inject | ✖ (tài liệu) | Tutorial ghi hazard đổi "target và current". Với `kuksa.val.v2` (mặc định từ 2026-10-17), app chỉ đổi giá trị hiện tại; người làm theo sẽ tưởng cột target bị lỗi. | **Đã sửa tutorial.** |
| 7 Flow | ✖ (tài liệu) | Tutorial chưa nhắc tab Flow (M19), chỗ trả lời "vì sao app vừa làm thế". | **Đã thêm** vào bước 7. |

## Kết luận
- **Hai lỗi chặn người mới đã sửa:**
  - tên tiếng Việt ở dạng NFD bị từ chối;
  - tutorial nói sai về cột target.
- **Một chỗ thiếu trong tutorial đã bổ sung:** tab Flow.
- **Rủi ro còn lại cho mục tiêu < 10 phút:** lần SynCode đầu tiên trên máy lạnh. Chỉ đo được bằng test người thật trên máy sạch.
- **Tiêu chí "usability test 5 người" (13 §5):** **chưa đạt bằng người thật**. Mục này được đóng theo quyết định D5, kèm đề xuất ở đầu tài liệu.

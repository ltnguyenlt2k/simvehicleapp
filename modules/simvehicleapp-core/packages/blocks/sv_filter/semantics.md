# `sv_filter` v1 — Filter

Nguồn: [ADR-0049](../../../../../analysis/adr/ADR-0049-filter-state-machine-subworkflow.md) §1, [05 §2.6](../../../../../analysis/05-blocks-and-execution-model.md#26-state).

- **Loại:** bước (category `state`, P2); handle vào `target`, ra `source` và `error`.
- **Opcode:** `state.filter` (args `value`, `mode`, `window` hoặc `alpha`). Mỗi lần chạy thêm một mẫu `value` (đổi sang
  `double`, giữ đơn vị) vào trạng thái của block rồi trả giá trị đã lọc.
- **`value`:** biểu thức số (số nguyên/thực; boolean/chuỗi ⇒ `TYPE_MISMATCH`).
- **`mode`:**
  - `moving-average` (mặc định): trung bình `window` mẫu gần nhất — cộng **theo thứ tự cũ → mới** rồi chia số mẫu.
  - `exponential` (low-pass): mẫu đầu `y = x`, sau đó `y = y + alpha · (x − y)`.
  - `median`: trung vị `window` mẫu gần nhất (số mẫu chẵn ⇒ trung bình hai phần tử giữa).
- **`window`:** 1…1000 (mặc định 5), cho `moving-average`/`median`. **`alpha`:** (0, 1] (mặc định 0.5), cho
  `exponential`; ngoài khoảng ⇒ `BLOCK_PROPERTY_INVALID`.
- **Outputs:** `value` (`double`, đơn vị của `value` vào), `samples` (số mẫu trong cửa sổ, hoặc tổng số mẫu với
  `exponential`).
- **Trạng thái:** theo block, sống suốt vòng đời app, mọi lượt chạy dùng chung (như In range/Hysteresis); app khởi
  động lại ⇒ trống.
- **Lỗi:** `value` không tính được (signal chưa có giá trị…) ⇒ handle `error`, mẫu không được thêm.
- **Side-effect:** không (ngoài trạng thái của chính block).

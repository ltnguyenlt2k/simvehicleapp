# `sv_on_signal_changed` v1 — When signal changes

Nguồn: [05 §2.1](../../../../../analysis/05-blocks-and-execution-model.md#21-triggers), [05 §3.2](../../../../../analysis/05-blocks-and-execution-model.md#32-chính-sách-đồng-thời-concurrency-policy-của-trigger), ADR-0010 §6, ADR-0011.

- **Loại:** trigger (category `triggers`) ⇒ không có handle vào; một handle ra `source` bắt đầu chuỗi bước của run.
- **Opcode:** `event.signal_changed` (args `signal`, `mode`, `threshold?`, `debounceMs`).
- **`path`:** VSS path kiểu `sensor` hoặc `actuator` (attribute không đổi lúc chạy ⇒ không cho chọn). Path mảng (`T[]`) được phép; chỉ `mode = any` có nghĩa với mảng (so sánh cả mảng).
- **`mode`:**
  - `any` (mặc định): bắn khi giá trị mới ≠ giá trị trước.
  - `rising` / `falling`: chỉ kiểu số hoặc boolean; bắn khi giá trị tăng / giảm (boolean: false→true / true→false).
  - `crosses_above` / `crosses_below`: chỉ kiểu số, cần `threshold`; bắn khi `previous ≤ threshold < value` / `previous ≥ threshold > value`.
  - `becomes`: cần `threshold` (cùng kiểu với signal, enum lấy từ `allowed`); bắn khi `value == threshold` và `previous != threshold`.
- **`threshold`:** giá trị cùng datatype với signal (`$signal`); int64/uint64 là chuỗi thập phân (ADR-0018 §7). Thiếu khi `mode` cần ⇒ lỗi compile (diagnostic ở M4).
- **`debounceMs`:** ≥ 0; > 0 ⇒ chỉ bắn khi điều kiện vẫn đúng sau khoảng thời gian này (đồng hồ đơn điệu; simulator dùng virtual clock).
- **`concurrency`:** `restart` mặc định (huỷ run cũ đang chờ, tạo run mới); `ignore` / `queue` (`queueMax` 8) / `parallel` (`maxRuns` 4) theo 05 §3.2.
- **Outputs:** `value`, `previous` (cùng kiểu/đơn vị signal), `timestamp` (ms). Lần cập nhật đầu tiên sau khi subscribe: `previous` chưa có ⇒ chỉ `mode = any` bắn, `previous` = `value`.
- **Side-effect:** subscribe signal trên databroker; không ghi gì.
- **Edge case:** mất kết nối databroker ⇒ không bắn, runtime tự reconnect (05 §3.6); giá trị không đổi ⇒ không bắn ở mọi mode.

# `sv_set_actuator` v1 — Set ⟨actuator⟩

Nguồn: [05 §2.3](../../../../../analysis/05-blocks-and-execution-model.md#23-actuators-sinh-từ-vss), [05 §3.6](../../../../../analysis/05-blocks-and-execution-model.md#36-lỗi-runtime), ADR-0010 §6, ADR-0018 §2.

- **Loại:** bước (category `actuators`); handle vào `target`, ra `source` (ghi thành công) và `error`.
- **Opcode:** `vehicle.write` (args `signal`, `value`).
- **`path`:** chỉ `actuator`, và **không** được là kiểu mảng (ADR-0018 §2 — không có actuator mảng trong VSS 4.0/4.2). Chọn sensor/attribute ⇒ lỗi compile `VEHICLE_WRITE_READ_ONLY`.
- **`value`:** biểu thức kiểu `$signal`; enum (`allowed`) ⇒ dropdown; giá trị phải nằm trong `[min, max]` / `allowed` của catalog (kiểm tĩnh nếu là hằng, ngoài ra kiểm lúc chạy). int64/uint64 là chuỗi thập phân trong JSON.
- **`awaitAck`** (mặc định `true`): chờ databroker xác nhận ⇒ **yield point**; `false` ⇒ gửi rồi đi tiếp ngay (lỗi chỉ được log).
- **`onError`** (mặc định `continue`): khi ghi lỗi mà handle `error` không được nối — `continue` = log + đi tiếp qua `source`; `stop` = dừng run.
- **Outputs:** `ok` (boolean), `error` (chuỗi mô tả lỗi, rỗng khi ok).
- **Lỗi:** UNAVAILABLE / NOT_FOUND / ACCESS_DENIED / giá trị ngoài miền ⇒ handle `error`.
- **Side-effect:** ghi target value của actuator trên databroker (KUKSA); không bao giờ ghi giá trị cảm biến.

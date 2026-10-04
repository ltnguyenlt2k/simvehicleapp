# `sv_switch` v1 — Switch (P1)
Nguồn: [05 §2.5–2.7](../../../../../analysis/05-blocks-and-execution-model.md#25-flow-control), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md).

- **Opcode:** `control.switch`. Handle vào `target`; ra **họ handle `case`** = `case-<i>` (i = vị trí trong `cases`, từ 0) và `default`.
- **`value`:** biểu thức; **`cases`:** danh sách `{when}` (literal/biểu thức cùng kiểu `value`), so khớp theo thứ tự, case đầu khớp thắng; không case nào khớp ⇒ `default`.
- `when` lặp lại ⇒ case sau không bao giờ chạy (lint cảnh báo); giá trị enum ngoài `allowed` ⇒ `ENUM_VALUE_NOT_ALLOWED`.

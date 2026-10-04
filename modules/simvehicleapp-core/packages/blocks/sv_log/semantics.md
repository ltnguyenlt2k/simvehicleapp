# `sv_log` v1 — Log
Nguồn: [05 §2.5–2.7](../../../../../analysis/05-blocks-and-execution-model.md#25-flow-control), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md).

- **Opcode:** `comm.log`. Bước thường, không yield; ghi log JSON một dòng của app (thấy ở Run console, M8).
- **`level`:** `debug`/`info` (mặc định)/`warn`/`error`; **`message`:** văn bản, `<ref>` viết thẳng trong chữ được thay bằng giá trị (`Speed <Vehicle.Speed> km/h`); ngoặc nhọn là chữ thường (ADR-0013 Notes M03-T11).

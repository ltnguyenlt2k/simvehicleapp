# `sv_on_mqtt` v1 — When MQTT message
Nguồn: [05 §2](../../../../../analysis/05-blocks-and-execution-model.md#2-catalog-block-chi-tiết-v1), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md), [ADR-0013](../../../../../analysis/adr/ADR-0013-dataflow-and-expression-language.md).

- **Loại:** trigger; opcode `event.mqtt_message`; handle ra `source`.
- **`topic`:** topic hoặc filter (`+`, `#`) trên broker của runtime. **`payloadType`:** `text` (mặc định) hoặc `json` (parse; payload lỗi ⇒ log, không bắn).
- **`concurrency`:** mặc định `queue` (xử lý tuần tự, tối đa 8, tràn ⇒ bỏ cũ nhất + trace).
- **Outputs:** `payload` (string hoặc json theo `payloadType`), `topic` (topic thật của message).

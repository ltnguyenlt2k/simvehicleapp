# `sv_mqtt_publish` v1 — Publish MQTT
Nguồn: [05 §2.5–2.7](../../../../../analysis/05-blocks-and-execution-model.md#25-flow-control), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md).

- **Opcode:** `comm.mqtt_publish`. Gửi không chờ xác nhận (không yield, ADR-0012 §3); lỗi gửi ⇒ handle `error`.
- **`topic`:** chuỗi topic (không wildcard); **`payload`:** template; **`payloadType`:** `text` (mặc định) hoặc `json` (payload phải là JSON hợp lệ sau khi thay template); **`qos`:** 0/1/2 (mặc định 0); **`retain`:** mặc định false.

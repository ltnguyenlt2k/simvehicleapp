# `sv_hmi_notify` v1 — HMI notification
Nguồn: [05 §2.5–2.7](../../../../../analysis/05-blocks-and-execution-model.md#25-flow-control), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md).

- **Opcode:** `comm.hmi_notify` — compiler **desugar** thành `comm.mqtt_publish` JSON `{severity, title, message, ts}` lên topic HMI cấu hình của app (`simvehicleapp/<app>/hmi`). Không có actuator HMI trong VSS 4.0 (skill vss-signals) nên cảnh báo đi qua MQTT.
- **`severity`:** `info` (mặc định)/`warning`/`critical`; **`title`**, **`message`:** template.

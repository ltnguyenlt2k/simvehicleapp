# `sv_stop` v1 — Stop
Nguồn: [05 §2.5–2.7](../../../../../analysis/05-blocks-and-execution-model.md#25-flow-control), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md).

- **Opcode:** `control.stop`. Handle vào `target`; **không** có handle ra.
- **`scope`:** `run` (mặc định, kết thúc run hiện tại), `workflow` (huỷ mọi run của workflow), `app` (dừng app). Huỷ qua cancel token: mọi timer/continuation của phạm vi bị huỷ (ADR-0012 §6).

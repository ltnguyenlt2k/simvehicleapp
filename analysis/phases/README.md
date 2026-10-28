# Phases — kế hoạch chi tiết từng milestone

> Thứ tự & phụ thuộc: [13-implementation-roadmap](../13-implementation-roadmap.md). Mỗi file có: Mục tiêu · Input/ADR · Tasks (ID, module, file, kết quả, test) · DoD · Acceptance Gate · Rủi ro.
> Quy ước ID task: `M<nn>-T<nn>`. Mỗi task ≤ 2 ngày; lớn hơn phải tách. Khi xong milestone: viết report theo [REPORT_TEMPLATE.md](REPORT_TEMPLATE.md) vào `docs/reports/M<nn>.md` của meta-repo.
> **Tracking tiến độ từng feature (cập nhật khi code xong, không phải khi lập kế hoạch):** [`docs/ROADMAP.md`](../../docs/ROADMAP.md).

| File | Milestone |
|---|---|
| [M00-foundations.md](M00-foundations.md) | Foundations, meta-repo, contracts, spikes |
| [M01-studio-shell.md](M01-studio-shell.md) | Fork Sim, gỡ ee/copilot, rebrand, compose |
| [M02-vss-catalog-and-vehicle-blocks.md](M02-vss-catalog-and-vehicle-blocks.md) | VSS catalog, toolbar Vehicle, block vehicle |
| [M03-logic-flow-blocks.md](M03-logic-flow-blocks.md) | Logic/Flow/State/Comm blocks, expression, lint |
| [M04-compiler-ir.md](M04-compiler-ir.md) | Graph→IR, diagnostics |
| [M05-simulator.md](M05-simulator.md) | Simulator & Simulate UI |
| [M06-cpp-backend-and-runtime.md](M06-cpp-backend-and-runtime.md) | Runtime C++ + compiler-code-cpp |
| [M07-workspace-toolchain-syncode.md](M07-workspace-toolchain-syncode.md) | Workspace, toolchain, SynCode E2E |
| [M08-live-run-observability.md](M08-live-run-observability.md) | Live run, signals, trace |
| [M09-ide-export-license.md](M09-ide-export-license.md) | IDE, export, license hooks |
| [M10-ai-assistant-mcp.md](M10-ai-assistant-mcp.md) | AI chat + MCP |
| [M11-hardening-release.md](M11-hardening-release.md) | Parity, E2E, cleanup, v1.0 |
| [M12-python-backend.md](M12-python-backend.md) | Python |
| [M13-rust-backend.md](M13-rust-backend.md) | Rust feasibility |
| [M14-services-curated-multiuser.md](M14-services-curated-multiuser.md) | Mở rộng sau v1.0 |
| [M15-final-e2e-demo-video.md](M15-final-e2e-demo-video.md) | **Bước cuối:** E2E Playwright toàn diện (kéo thả, full luồng) + video demo trong README |
- [M16 — Trải nghiệm end-user + kiểm soát tài nguyên](M16-ux-and-capacity.md) (PO 2026-10-14)
- [M17 — Dọn bề mặt Sim còn sót + runtime xe dùng chung](M17-editor-leftovers-and-run-slot.md) (PO 2026-10-15)
- [M18 — Bàn thử nghiệm, workflow dễ đọc v2, Deploy](M18-test-workbench-readability-deploy.md) (PO 2026-10-15)
- [M19 — Luồng thực thi (Flow) và thử tín hiệu chỉn chu](M19-execution-flow-and-signal-testing.md) (PO 2026-10-24)
- [M20 — Target WebAssembly cho C++ và Rust + host runtime](M20-wasm-targets.md) (PO 2026-10-24)
- [M21 — Hoàn tất roadmap](M21-roadmap-completion.md) (PO 2026-10-25)
- **Robotics — stack độc lập `robotics/`** (PO 2026-10-27, viết lại 2026-10-28: "độc lập, không dùng lại cái gì hiện có"; [design](../../docs/design/M22-robotics-extension.md); ADR 0064–0068 chờ PO):
  - [M22 — Nền móng `robotics/` + RSS v0.1 + spike robot](M22-robotics-foundation-and-rss.md)
  - [M23 — Protobus core (`protobus.v1`, broker, provider mock)](M23-protobus-core.md)
  - [M24 — Protobus bridge ROS 2 + adapter dog](M24-protobus-ros2-bridge.md)
  - [M25 — RobotFlow: compiler `rflowc` + runtime `rfrt`](M25-robotflow-compiler-runtime.md)
  - [M26 — Robot Studio](M26-robot-studio.md)
  - [M27 — E2E `@live`, video, tài liệu](M27-robotics-e2e-video-docs.md)

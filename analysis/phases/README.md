# Phases — kế hoạch chi tiết từng milestone

> Thứ tự & phụ thuộc: [13-implementation-roadmap](../13-implementation-roadmap.md). Mỗi file có: Mục tiêu · Input/ADR · Tasks (ID, module, file, kết quả, test) · DoD · Acceptance Gate · Rủi ro.
> Quy ước ID task: `M<nn>-T<nn>`. Mỗi task ≤ 2 ngày; lớn hơn phải tách. Khi xong milestone: viết report theo [REPORT_TEMPLATE.md](REPORT_TEMPLATE.md) vào `docs/reports/M<nn>.md` của meta-repo.

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

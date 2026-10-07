# compiler-code-rust (feasibility, M13)

Backend Rust của SimVehicleApp (ADR-0041 — **thử nghiệm, không phải tooling Velocitas**: Velocitas không có template
Rust): IR v1 ⇒ vehicle app Rust trên runtime `simvehicleapp-runtime` (crate) với `kuksa-rust-sdk` 0.2.2
(`sdv.databroker.v1`, cùng hành vi C++/Python) và MQTT `rumqttc`. Chỉ phụ thuộc contracts.

| Thư mục | Nội dung |
|---|---|
| `generator/` | Service `codegen-rust` :4130 (Bun, TypeScript): `/capabilities`, `/generate`, `/runtime/files`, `/template-overlay/files` — thuần, tất định |
| `runtime/` | Crate `simvehicleapp-runtime` (Rust 1.98, edition 2021): strand (t, seq), interpreter run/fiber/policy/trace port từ runtime C++/Python, `values` (ngữ nghĩa simulator), `testing`; feature `host` = app thật (tokio current-thread, kuksa-rust-sdk, rumqttc) |
| `template-overlay/` | `app/src/main.rs` (host chạy workflow sinh ra), `app/src/user_hooks.rs` |
| `golden/` | Snapshot Rust của GW-A…GW-G (diff = 0) |
| `backend.yaml` | Manifest plugin; `templateSha` = git tree id của template `velocitas-stack/templates/vehicle-app-rust-template` |

Code sinh: `bind(&Runtime)` + closure, `#[rustfmt::skip]` (bố cục do generator, như `DisableFormat` của C++),
`cargo fmt --check` và `cargo clippy` sạch. Test sinh ra là test target `generated` với harness riêng in dòng kiểu gtest.

```bash
cd generator && bun install --frozen-lockfile
bun run check && bun test                    # golden Rust, determinism, contracts, fuzz
conformance/conformance.sh                   # P1: 38 conformance + 7 golden + fuzz, trong image rust:1.98.1-slim-bookworm
```

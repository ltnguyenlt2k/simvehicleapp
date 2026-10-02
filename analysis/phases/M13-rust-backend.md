# M13 — `compiler-code-rust` (feasibility)

**ADR:** 0041 · **Phụ thuộc:** M11

| ID | Task |
|---|---|
| M13-T01 | Template `vehicle-app-rust-template` (AppManifest v3, Cargo workspace, Dockerfile musl static) |
| M13-T02 | Runtime `simvehicleapp-runtime-rs` (tokio current_thread, CancellationToken, policies, trace) + conformance |
| M13-T03 | Client `kuksa-rust-sdk 0.2.2` qua `sdv.databroker.v1`; typed signal module sinh từ VSS (chỉ path dùng) |
| M13-T04 | Generator emitters P0 → GW-A |
| M13-T05 | toolchain-rust (cargo vendor offline) |
| M13-T06 | Báo cáo feasibility: coverage, parity, build time, binary size, rủi ro → Go/No-go |

**Gate:** GW-A live + parity; báo cáo được review.

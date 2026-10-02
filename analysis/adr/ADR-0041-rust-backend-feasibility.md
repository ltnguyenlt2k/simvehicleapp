# ADR-0041: Rust backend — feasibility trước, dựa `kuksa-rust-sdk`

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L2
- **Related:** FR-CG-04, R19; [00 §3.7](../00-research-findings.md#37-rust)

## Context
`eclipse-velocitas/vehicle-app-rust-sdk` gần như rỗng; không có Rust template/model generator. `eclipse-kuksa/kuksa-rust-sdk 0.2.2` (Apache-2.0) hỗ trợ `kuksa.val.v2/v1`, `sdv.databroker.v1`.

## Decision
1. M13 là **feasibility**: prototype GW-A với
   - template tự tạo `vehicle-app-rust-template` (cấu trúc giống Velocitas: `app/AppManifest.json` v3, `app/src/main.rs`, `Cargo.toml`, `Dockerfile` multi-stage static musl);
   - vehicle model: generator TS sinh module Rust typed từ VSS (chỉ các signal được dùng, không cả cây);
   - runtime `simvehicleapp-runtime-rs` (tokio current-thread = strand; `CancellationToken`; policies; trace);
   - client `kuksa-rust-sdk` với `sdv.databroker.v1` để cùng hành vi C++/Python.
2. Toolchain `toolchain-rust` FROM `rust:<pin>-bookworm` + `cargo vendor` offline cache; không dùng velocitas CLI (không hỗ trợ Rust) — ghi rõ trong UI "Rust (experimental, non-Velocitas tooling)".
3. Báo cáo feasibility: độ phủ opcode, parity, kích thước binary, thời gian build, rủi ro bảo trì. Go/No-go cho implement đầy đủ.

## Verification
GW-A build + run + parity pass; báo cáo `docs/spikes/rust-feasibility.md`.

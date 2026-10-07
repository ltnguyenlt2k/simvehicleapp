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

## Notes / Deviations

### 2026-10-07 — hiện thực feasibility M13 (Claude Code, theo uỷ quyền PO 2026-10-06 — chờ PO xác nhận)
1. **Runtime = port runtime C++/Python** (strand (t, seq), continuation), không phải "`CancellationToken` theo task" như
   Decision §1: cùng lý do tất định như ADR-0040 Notes §1; tokio current-thread chỉ là đồng hồ thật + I/O. Conformance
   P1 46/46.
2. **Client:** dùng stub `sdv.databroker.v1` do `kuksa-rust-sdk` 0.2.2 sinh (`sdv_proto::broker_client`) trên một tonic
   channel dùng chung (struct `Client`/`SDVClient` của SDK không `Clone`, phương thức `&mut self`); MQTT qua `rumqttc`
   (topic thật thay vì filter như SDK Python).
3. **Vehicle model:** không sinh module typed như Decision §1 — code sinh dùng VSS path; kiểu được kiểm lúc build bằng
   `sv-check-signals` (signal + datatype so với VSS của AppManifest), như `check_project` của Python.
4. **Template của SimVehicleApp** (`velocitas-stack/templates/vehicle-app-rust-template`): `backend.yaml templateSha`
   = git tree id của thư mục (contract đòi 40 hex; CI kiểm khớp). Thư mục SynCode sở hữu để trống (ADR-0026): `build.rs`
   trỏ crate vào code sinh khi có; test target `generated` = `tests/scenarios.rs` `include!` file sinh.
5. **Bố cục code sinh:** `#[rustfmt::skip]` (heuristic độ rộng của rustfmt không tái tạo), như `DisableFormat` C++;
   `cargo fmt --check` + `cargo clippy` sạch (CI `-D warnings` trên runtime).
6. **Contract:** `toolchain.v1 /templates?lang` thêm `rust` (mở rộng enum, tương thích ngược). Studio/orchestrator: thêm
   Rust vào danh sách ngôn ngữ và notice export — cùng kiểu sửa trung lập ngôn ngữ của ADR-0040 Notes §8.
7. **Kết quả + đề xuất Go (experimental):** [báo cáo khả thi](../../docs/spikes/rust-feasibility.md) — parity P3 7/7 (lệch
   ≤ 2 ms), binary 3,0 MB, SynCode ~20 s. Go/No-go chờ PO.

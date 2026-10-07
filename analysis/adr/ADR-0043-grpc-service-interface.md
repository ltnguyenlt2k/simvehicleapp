# ADR-0043: Block gọi gRPC service (`service.grpc_call`) qua AppManifest `grpc-interface` — hoãn tới khi toolchain sinh SDK offline

- **Status:** Proposed
- **Date:** 2026-10-07
- **Level:** L1 Subsystem
- **Deciders:** Claude Code theo uỷ quyền PO 2026-10-06 — chờ PO xác nhận
- **Related:** FR-BLK-08; [04 §1](../04-velocitas-deep-dive.md); [ADR-0023](ADR-0023-velocitas-project-layout-and-manifest.md); [ADR-0025](ADR-0025-headless-velocitas-toolchain.md); [05](../05-blocks-and-execution-model.md) `sv_grpc_call`; [06](../06-ir-and-compiler.md) `service.grpc_call` (đã có trong enum IR v1); [phases/M14](../phases/M14-services-curated-multiuser.md) #2

## Context
- Upstream (pin `devenv-devcontainer-setup` v3.0.0 = bản mới nhất, kiểm 2026-10-07): component `grpc-interface-support`
  (`velocitas exec grpc-interface-support generate-sdk`, chạy `onPostInit`) đọc interface `grpc-interface` trong
  AppManifest (`src` proto: file/dir/zip/URL, `required` = client methods, `provided` = server, `protoIncludeDir`) và sinh
  SDK client/server qua factory — template **chỉ C++ và Python** (`data/templates/{cpp,python}`); không có Rust.
- Spike 2026-10-07 trong `simvehicleapp/toolchain-cpp:dev`: package có ở `~/.velocitas/packages/devenv-devcontainer-setup/v3.0.0/grpc-interface-support`
  nhưng **chưa cài** requirements (`velocitas-lib==0.0.13`, `proto-schema-parser==1.3.4`, `shell-source`), không có
  `protoc`, không có `grpc_tools`; C++ cần thêm Conan `grpc` (build từ nguồn, nặng). ⇒ SynCode offline (ADR-0025) hiện
  **không** sinh được SDK gRPC.
- Simulator/parity cần một service giả lập có ngữ nghĩa xác định (scenario) và một server thật trong stack cho P3.

## Decision
1. Block `sv_grpc_call` (props `service`, `method`, `args` theo proto; outputs theo message trả về; handle `source`/`error`)
   lower thành `service.grpc_call` — **yield point**, timeout mặc định 2000 ms ⇒ `error`, như `fresh-read`.
2. Proto của project PHẢI vendored trong project (`app/proto/**`, `src` tương đối) — không tải URL lúc SynCode (offline,
   tái lập). Workspace là nơi duy nhất ghi file proto (luật cứng 3).
3. Simulator: scenario thêm `services: [{service, method, at?, response | error, latencyMs}]` (mặc định: không có ⇒ lỗi
   `UNAVAILABLE` sau timeout); conformance case mới cho timeout/error/success.
4. Backend: C++/Python dùng SDK do `grpc-interface-support` sinh (client factory) — runtime chỉ bọc lời gọi vào strand;
   Rust dùng `tonic-build` riêng (không có template Velocitas) — chỉ khi ADR-0041 bỏ nhãn experimental.
5. **Điều kiện bắt đầu (chưa đạt):** toolchain C++/Python cài sẵn requirements + `grpcio-tools` (wheelhouse) và Conan
   `grpc` trong cache image, `generate-sdk` chạy offline trên một proto mẫu trong CI; một service mẫu trong stack (profile
   riêng) cho parity P3. Tới lúc đó **hoãn**; IR giữ opcode trong enum nhưng không backend nào khai báo hỗ trợ (S7 trả
   `OPCODE_UNSUPPORTED_BY_BACKEND`).

## Alternatives considered
| Phương án | Ưu | Nhược | Vì sao loại |
|---|---|---|---|
| Runtime tự gọi gRPC động (reflection) | Không cần sinh SDK | Không đi theo Velocitas; kiểu không kiểm được lúc compile | Trái nguyên tắc code sinh dùng SDK chuẩn |
| HTTP/JSON thay gRPC | Đơn giản | Velocitas không có; không phải chuẩn SDV service | Lệch hệ sinh thái |
| Tải proto/requirements lúc SynCode | Ít việc toolchain | Vỡ offline, không tái lập | Trái ADR-0025 |

## Consequences
- Tích cực: lộ trình rõ, giữ offline/tất định; opcode IR đã có nên không đổi contract IR.
- Tiêu cực / nợ: image toolchain C++ lớn hơn (gRPC Conan); cần service mẫu cho parity.
- Ảnh hưởng module: velocitas-stack (toolchain), core (block, compiler, simulator, scenario), `compiler-code-{cpp,python}`,
  workspace (vendored proto), studio (editor proto/method).

## Implementation
| Task | Module | Milestone |
|---|---|---|
| Spike toolchain (2026-10-07: thiếu requirements/protoc/grpc) | docs | M14 #2 ✔ |
| Wheelhouse + Conan grpc cache; `generate-sdk` offline trong CI | velocitas-stack | sau (chờ PO) |
| Scenario `services`, simulator, conformance | core, contracts | sau |
| Block + emitter C++/Python + service mẫu + P3 | core, backends, stack | sau |

## Verification
`generate-sdk` offline PASS trong CI; conformance gRPC trên simulator + C++/Python; parity P3 với service mẫu.

## Notes / Deviations

# ADR-0047: Chuyển sang `kuksa.val.v2` từng backend trên databroker 0.5.0, signal-gateway làm provider, rồi mới nâng databroker

- **Status:** Proposed
- **Date:** 2026-10-07
- **Level:** L1 Subsystem
- **Deciders:** Claude Code theo uỷ quyền PO 2026-10-06 — chờ PO xác nhận
- **Related:** [ADR-0024](ADR-0024-databroker-api-and-runtime-stack.md) §7 (kế hoạch v2), [00 §3.5–3.8](../00-research-findings.md),
  [ADR-0040](ADR-0040-python-backend.md), [ADR-0041](ADR-0041-rust-backend-feasibility.md), [ADR-0042](ADR-0042-semantic-parity-testing.md);
  spike [docs/spikes/kuksa-val-v2](../../docs/spikes/kuksa-val-v2/README.md); [phases/M14](../phases/M14-services-curated-multiuser.md) #5

## Context
- Hiện tại (ADR-0024): databroker **0.5.0** `--enable-databroker-v1`; cả ba backend dùng `sdv.databroker.v1`
  (C++ SDK mặc định, Python SDK 0.15.7 chỉ có v1, Rust host dùng stub `sdv_proto` của `kuksa-rust-sdk`); signal-gateway
  mirror target → current bằng `kuksa.val.v1`.
- Upstream (kiểm 2026-10-07, chi tiết trong spike): **databroker 0.7.0 đã xoá `sdv.databroker.v1`**; mới nhất 0.7.1 chỉ
  phục vụ `kuksa.val.v1` + `kuksa.val.v2`. Velocitas Python SDK mới nhất vẫn v0.15.7 (chỉ v1). `kuksa-client` 0.6.0 và
  `kuksa-rust-sdk` 0.2.2 có stub v2; C++ SDK chọn bằng `KUKSA_DATABROKER_API=kuksa.val.v2`.
- Spike trên 0.5.0: v2 chạy song song với `sdv.databroker.v1`; `Actuate` không provider ⇒ `UNAVAILABLE`; provider qua
  `OpenProviderStream` nhận actuation theo **id số**, một actuator một provider (`ALREADY_EXISTS`); current đổi khi
  provider `PublishValue`.
- Hệ quả: nâng databroker ≥ 0.7 trước khi cả ba backend dùng v2 ⇒ mọi app sinh ra **không chạy** được.

## Decision
1. **Giữ pin databroker 0.5.0** (phục vụ cả `sdv.databroker.v1` và `kuksa.val.v2`) trong suốt quá trình chuyển. KHÔNG được
   nâng lên ≥ 0.7 cho tới khi bước 4 xong và gate bên dưới PASS.
2. **signal-gateway thành provider v2** cho stack dev, thay mirror target → current: khi Run bắt đầu, mở
   `OpenProviderStream` claim đúng các actuator app ghi (IR `signals[].access` có `write`, như `PUT /mirror` hiện tại);
   mỗi `BatchActuateStreamRequest` ⇒ `PublishValue` giá trị đó làm current (tra id ↔ path bằng `ListMetadata`); đóng
   stream khi Run kết thúc. Actuator đã có provider khác (`ALREADY_EXISTS`) ⇒ báo trên UI, không ép.
3. **Runtime mỗi backend có hai host API**, chọn bằng `SV_DATABROKER_API` = `sdv.databroker.v1` (mặc định tới khi gate
   PASS) | `kuksa.val.v2`: Rust (stub `v2_proto` của `kuksa-rust-sdk`), C++ (`KUKSA_DATABROKER_API` của SDK), Python
   (stub v2 của `kuksa-client` — license Apache-2.0, cần mục license-compliance). Ngữ nghĩa runtime (strand, write ack =
   `Actuate` OK, subscribe) không đổi; ghi = `Actuate`/`BatchActuate`.
4. Thứ tự: Rust → C++ → Python, mỗi bước parity P3 7/7 với `kuksa.val.v2` + provider của signal-gateway; sau đó đổi
   mặc định sang v2, rồi mới ADR mới nâng databroker (0.7.x) + bỏ `--enable-databroker-v1`.
5. **Không trộn** API cho cùng actuator trong một Run (app v2 + mirror v1) — signal-gateway chọn provider v2 hay mirror
   v1 theo API của generation đang chạy.

## Diagram
```mermaid
sequenceDiagram
  participant App as App (kuksa.val.v2)
  participant VDB as databroker 0.5.0
  participant GW as signal-gateway (provider)
  GW->>VDB: OpenProviderStream(ProvideActuation [actuators app ghi])
  App->>VDB: Actuate(Hazard = true)
  VDB->>GW: BatchActuateStreamRequest(id 65 = true)
  VDB-->>App: OK (đã chuyển cho provider)
  GW->>VDB: PublishValue(Hazard current = true)
  VDB-->>App: Subscribe: Hazard = true
```

## Alternatives considered
| Phương án | Ưu | Nhược | Vì sao loại |
|---|---|---|---|
| Nâng thẳng databroker 0.7.1 | Mới, có fix bảo mật | Xoá `sdv.databroker.v1` ⇒ cả ba backend hỏng | Vỡ toàn bộ app |
| Giữ v1 mãi | Không việc | Bị khoá ở 0.6.x, không nhận fix tương lai | Nợ tích luỹ |
| mock-provider làm provider | Có sẵn | Chỉ đọc `mock.py` lúc start, không điều khiển được trong stack (ADR-0024 Notes S-4) | Không động theo Run |
| Python tự sinh stub từ proto | Không thêm dependency | Duy trì protoc/stub riêng | `kuksa-client` đã có, cùng nguồn Eclipse |

## Consequences
- Tích cực: lộ trình tới databroker 0.7.x không làm gãy app; Rust làm mẫu (đã có stub v2 trong lock hiện tại).
- Tiêu cực / nợ: hai host API song song một thời gian; signal-gateway thêm vai provider; Python thêm `kuksa-client`.
- Ảnh hưởng module: signal-gateway, `compiler-code-{rust,cpp,python}` (runtime host), velocitas-stack (env, toolchain
  wheel/crate), orchestrator (truyền API của generation cho signal-gateway).

## Implementation
| Task | Module | Milestone |
|---|---|---|
| Spike v2 + provider trên 0.5.0 | docs/spikes | M14 #5 ✔ (2026-10-07) |
| signal-gateway provider v2 (id ↔ path, mở/đóng theo Run) | signal-gateway | M14 #5 sau |
| Rust host `kuksa.val.v2` + parity P3 | compiler-code-rust | M14 #5 sau |
| C++ (`KUKSA_DATABROKER_API`) + parity P3 | compiler-code-cpp | M14 #5 sau |
| Python (`kuksa-client` v2) + license + parity P3 | compiler-code-python | M14 #5 sau |
| Đổi mặc định v2; ADR nâng databroker 0.7.x | velocitas-stack | sau gate |

## Verification
- Spike (đã chạy, 2026-10-07): output trong [README spike](../../docs/spikes/kuksa-val-v2/README.md).
- Mỗi backend: conformance P1 không đổi; parity P3 7/7 với `SV_DATABROKER_API=kuksa.val.v2`.
- Gate nâng databroker: cả ba backend P3 7/7 trên v2 + signal-gateway provider; E2E live (tutorial, m12-python-live).

## Notes / Deviations
- 2026-10-17 — **Bước 3 xong cho cả ba backend, đã đổi mặc định sang `kuksa.val.v2`.** Theo uỷ quyền PO 2026-10-06 — chờ PO xác nhận.
  - **C++:** SDK 0.7.1 đã có client v2 (`KUKSA_DATABROKER_API=kuksa.val.v2`, ghi = `BatchActuate`). Runtime dùng `IVehicleDataBrokerClient::createInstance`, nên chỉ cần env. Orchestrator đặt cả `KUKSA_DATABROKER_API` lẫn `SV_DATABROKER_API`. Parity P3 7/7 ([bằng chứng](../../docs/reports/evidence/M14-parity-p3-cpp-kuksa-val-v2.json)), log app: "Using Kuksa Databroker kuksa.val.v2 API".
  - **Python:** SDK 0.15.7 chỉ có v1.
    - Runtime thêm `KuksaV2VehicleAccess` trên stub v2 sinh từ proto 0.5.0 bằng grpcio-tools 1.64.1 (trùng grpc của image), vendored ở `simvehicleapp_runtime/kuksa_v2/` (Apache-2.0, `# ruff: noqa`).
    - Không thêm dependency vào image offline, không dùng `kuksa-client`.
    - Parity P3 7/7 ([bằng chứng](../../docs/reports/evidence/M14-parity-p3-python-kuksa-val-v2.json)), log app: "databroker over kuksa.val.v2".
  - **Mặc định:**
    - orchestrator dùng `{"*": "kuksa.val.v2"}` + `SV_DATABROKER_API` để ghi đè (`*=sdv.databroker.v1` quay lại);
    - C++ mặc định parity 7/7 ([bằng chứng](../../docs/reports/evidence/M14-parity-p3-cpp-default-v2.json));
    - gate M17 runtime PASS (`gate-m17-1792221700`).
  - **Khác biệt người dùng thấy:** app v2 không ghi `target`. Gateway publish giá trị Actuate thành current, nên bảng Signals đổi ở cột hiện tại. User guide `test-signals` đã ghi chú.
  - **Chưa làm:** ADR mới để nâng databroker ≥ 0.7 và bỏ `--enable-databroker-v1`. Còn chặn bởi signal-gateway (dùng `kuksa.val.v1` để đọc/inject; 0.7 vẫn giữ `kuksa.val.v1`) và lựa chọn mặc định. Chờ PO.
- 2026-10-17 — **Bước 3, Rust xong: parity P3 7/7 trên `kuksa.val.v2`** ([bằng chứng](../../docs/reports/evidence/M14-parity-p3-rust-kuksa-val-v2.json), lệch ≤ 6 ms). Theo uỷ quyền PO 2026-10-06 — chờ PO xác nhận.
  - **Runtime Rust:** host thứ hai `VdbV2`, gồm GetValue, Subscribe theo path, ghi = Actuate. Chọn bằng `SV_DATABROKER_API`.
  - **Orchestrator:** `SV_DATABROKER_API` theo ngôn ngữ (vd. `rust=kuksa.val.v2`), truyền env cho app và `api` cho `PUT /mirror`.
  - **Agent:** thêm `SV_DATABROKER_API` vào allowlist env của run.
  - **Lỗi lộ ra trong gate:**
    1. `finish()` đánh dấu run xong rồi mới nhả mirror. Run kế (gate, *Stop … and run*) claim xong thì bị lệnh nhả muộn xoá. Sửa: nhả trước.
    2. Parity cần mô hình "không có xe trả lời", nên thêm `publish: false` cho provider v2 (chỉ chấp nhận). Đổi `publish` trên cùng tập actuator thì giữ claim, vì claim lại để hở một khoảng app ghi bị từ chối.
  - **Hồi quy:** C++ trên v1 vẫn 7/7 sau các thay đổi ([bằng chứng](../../docs/reports/evidence/M14-parity-p3-cpp-v1-after-v2.json)).
  - **Còn:**
    - C++ (`KUKSA_DATABROKER_API` của SDK 0.7.1) rồi Python, mỗi bước parity 7/7;
    - sau đó đổi mặc định sang v2;
    - rồi ADR mới để nâng databroker.
  - Mặc định vẫn `sdv.databroker.v1` cho mọi backend.
- 2026-10-17 — **Bước 2 (signal-gateway provider v2) xong** (Claude Code, theo uỷ quyền PO 2026-10-06 — chờ PO xác nhận):
  - `PUT /mirror` thêm `api`:
    - `sdv.databroker.v1` (mặc định): mirror target → current như trước;
    - `kuksa.val.v2`: gateway mở `OpenProviderStream` claim các actuator. Mỗi actuation được ack `ERROR_CODE_OK` rồi publish thành current; actuator không claim ⇒ `ERROR_CODE_NOT_FOUND`.
  - Id ↔ path qua `ListMetadata` với root = path, vì `Metadata` v2 không có path.
  - Claim bị provider khác giữ ⇒ 409 `provider_refused`. Claim lại cùng tập ⇒ giữ nguyên. Đổi tập ⇒ retry ngắn khi databroker chưa nhả claim cũ.
  - Proto v2 vendored từ 0.5.0 (`30e5c13`).
  - Bằng chứng:
    - unit gateway 17;
    - gate `gate/kuksa-v2-provider.sh` PASS trên databroker v4.0 của stack: Actuate không provider ⇒ UNAVAILABLE; có provider ⇒ current = 7 sau 31 ms; provider thứ hai ⇒ ALREADY_EXISTS; nhả ⇒ UNAVAILABLE.
  - **Còn:**
    - orchestrator chọn `api` theo generation: chưa backend nào sinh app v2, nên luôn v1;
    - bước 3–4: host v2 Rust → C++ → Python + parity P3.
- 2026-10-07: ADR-0024 §7 dự kiến "chuyển C++ trước khi Python SDK hỗ trợ v2"; thực tế Velocitas Python SDK vẫn chưa hỗ
  trợ, nhưng runtime Python của SimVehicleApp dùng client raw nên có thể dùng stub v2 của `kuksa-client` — không phải
  chờ SDK. Rust đi trước vì stub v2 đã có trong dependency đang khoá.

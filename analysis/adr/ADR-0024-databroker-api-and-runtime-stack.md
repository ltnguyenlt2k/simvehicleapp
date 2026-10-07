# ADR-0024: Databroker API & runtime stack trong compose

- **Status:** Accepted (2026-10-01 — spikes S-2/S-3/S-4 PASS) · **Date:** 2026-09-30 · **Level:** L1
- **Related:** FR-RUN-03/05, R13, R21; [00 §3.4–3.8](../00-research-findings.md); [04 §5](../04-velocitas-deep-dive.md#5-databroker-api-v1-hay-v2-tóm-tắt-adr-0024)

## Context
- runtime-local của Velocitas: `kuksa-databroker:0.5.0 --enable-databroker-v1` + `eclipse-mosquitto:2.0.14`, docker-in-docker, network host.
- C++ SDK: `KUKSA_DATABROKER_API` = `sdv.databroker.v1` (mặc định) | `kuksa.val.v2`; Python SDK chỉ `sdv.databroker.v1`.
- `kuksa.val.v2`: set actuator = Actuate → cần provider; không hỗ trợ WHERE.
- Databroker mới nhất 0.7.1 (2026-08) — sdv v1 deprecated.

## Decision
1. **MVP:** `ghcr.io/eclipse-kuksa/kuksa-databroker:0.5.0` với `--insecure --enable-databroker-v1 --vss <file của project release>`; app dùng `sdv.databroker.v1` (mặc định SDK, không set `KUKSA_DATABROKER_API`).
2. `eclipse-mosquitto:2.0.14` no-auth, port 1883 (+9001 websockets cho UI tap MQTT P1).
3. `mock-provider` (0.4.1) ở profile `mock` — bật mặc định nếu spike S-3/S-4 cho thấy cần để actuator phản hồi current value.
4. **signal-gateway** dùng `kuksa.val.v1` (subscribe VALUE + ACTUATOR_TARGET; set VALUE để inject sensor).
5. Env chạy app: `SDV_MIDDLEWARE_TYPE=native`, `SDV_VEHICLEDATABROKER_ADDRESS=grpc://databroker:55555`, `SDV_MQTT_ADDRESS=mqtt://mqtt:1883`, `SV_TRACE_LEVEL`.
6. 1 runtime stack dùng chung, 1 run active (MVP). Vì không container nào có docker.sock (ADR-0005), **không restart databroker từ bên trong**: compose khai báo **một databroker cho mỗi VSS release được hỗ trợ** (`databroker` = v4.0 bật mặc định; `databroker-v4-2`… ở profile riêng); orchestrator chọn endpoint theo `vssRelease` của project (`SV_DATABROKERS=v4.0=databroker:55555,v4.2=databroker-v4-2:55555`), signal-gateway cũng theo map này.
7. **Kế hoạch v2 (ADR-0047, M14):** chuyển sang databroker mới + `kuksa.val.v2` cho C++ khi Python SDK hỗ trợ hoặc khi bỏ Python v1; runtime ẩn khác biệt.

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| Databroker 0.7.1 ngay | Chưa được Velocitas tooling test cùng SDK 0.7.1; rủi ro sdv v1 hành vi khác |
| `kuksa.val.v2` ngay | Python SDK không hỗ trợ; cần provider cho mọi actuator |
| Giữ runtime-local (docker-in-docker) | Cần privileged/socket |

## Verification
Spike S-2/S-3/S-4 ghi `docs/spikes/`; integration test GW-A: inject Speed 130 trong 3 s ⇒ gateway thấy `Hazard.IsSignaling` = true (field value hoặc target theo kết quả spike).

## Notes / Deviations (M0, 2026-10-01)
- **Flags verified** (`--help` of 0.5.0): `--vss`, `--insecure`, `--enable-databroker-v1`, `--address` (image default `0.0.0.0`), `--port`, `--disable-authorization`, `--enable-viss`, `--worker-threads`. Image embeds `vss_release_4.0.json`; we still mount our pinned copy.
- **S-3 (source + live):** `sdv.databroker.v1 Broker.SetDatapoints` (= SDK `set()`) writes **only `actuator_target`**; sensors/attributes → `ACCESS_DENIED`; values outside `allowed` → `OUT_OF_BOUNDS`. Current value unchanged without a provider.
- **Decision added:** signal-gateway (a) displays both `value` and `target`, (b) in dev runs mirrors target→current for actuators written by the project (kuksa.val.v1 `set_current_values`, verified working), acting as a dynamic provider. Rationale: mock-provider loads `mock.py` only at startup and cannot be restarted from inside the stack (no docker.sock).
- **S-4:** mock-provider 0.4.1 = `VDB_ADDRESS` env + `/mock/mock.py` mount; upstream default mock animates `Vehicle.Speed` (would fight UI injection) → we ship `runtime/mock/mock.py`. Stays optional (`--profile mock`).
- SDK fires the first subscription item with `NOT_AVAILABLE` when no value exists → runtime must test availability before `value()` (template SampleApp logs an exception there).
- App stdout contains ANSI colour codes → log ingestion strips them.

## Notes / Deviations (2026-10-07) — M6
- Giữ `sdv.databroker.v1` (mặc định SDK) cho app C++, nhưng SDK 0.7.1 v1 gửi `UINT8`/`UINT16` sai kiểu wire (`int32_value`) ⇒ `INVALID_TYPE`; runtime C++ tránh ở adapter (ADR-0021 Notes §8). Khi nâng SDK cần kiểm lại (nếu upstream sửa, giữ workaround vẫn đúng vì `uint32` là kiểu wire chuẩn).
- Inject sensor cho kiểm thử live tạm dùng `kuksa-databroker-cli:0.5.0` (`publish`, cần TTY ⇒ `script`); M8 thay bằng signal-gateway.

## Notes / Deviations (2026-10-07) — M8 (runtime stack, signal-gateway), theo uỷ quyền PO 2026-10-06, chờ PO xác nhận
- **Databroker cho VSS v4.2 bật mặc định** (`databroker-v4-2`, `--vss vss_rel_4.2.json`, chỉ mạng nội bộ) thay vì profile riêng (§6): databroker 0.5.0 nạp v4.2 không lỗi, nhàn rỗi vài MB; profile tắt sẽ làm Run của project v4.2 hỏng âm thầm. Hai bản VSS trong `modules/velocitas-stack/vss/` là bản sao byte-identical của fixtures contracts (sha256 + MPL-2.0 trong `vss/PROVENANCE.md`). `SV_DATABROKERS=v4.0=databroker:55555,v4.2=databroker-v4-2:55555` dùng chung cho orchestrator (Run) và signal-gateway; kiểm live: inject cùng path vào hai release cho hai giá trị riêng.
- **signal-gateway** (`modules/simvehicleapp-orchestrator/services/signal-gateway`, :4050): client `kuksa.val.v1` bằng `@grpc/grpc-js` 1.14.0 + `@grpc/proto-loader` 0.8.0 (Apache-2.0) trên Bun 1.3.8, proto vendored nguyên vẹn từ kuksa-databroker tag `0.5.0` (commit `30e5c13`). Đã kiểm với databroker 0.5.0 thật: Get, Set current value (sensor — vai feeder), Set actuator target, Subscribe value + target.
- **Kiểm giá trị trước databroker:** path phải thuộc catalog của release (`GET /vss` của vss-catalog), giá trị đúng datatype (số nguyên kiểm range theo int8…uint64, int64/uint64 là chuỗi thập phân), `allowed`, `min`/`max` ⇒ 400 có thông điệp rõ; databroker từ chối (ví dụ `ACCESS_DENIED`) ⇒ 422 kèm lý do.
- **Mirror target → current (vai provider, Notes M0):** orchestrator đặt `PUT /mirror` = các actuator mà app ghi (từ IR của generation, `signals[].access` có `write`) khi Run bắt đầu và xoá khi Run kết thúc. Kiểm live: Hazard target true ⇒ current value true.
- **Transport cho UI:** SSE `GET /signals` + `POST /signals` thay cho WebSocket trong skeleton contract (Next.js route handler của BFF không proxy được WebSocket; cùng kiểu với log/trace) — ADR-0027 Notes 2026-10-07.
- Scenario player (M08-T07) trong gateway: `initial` ngay, input theo thời gian; input topic publish MQTT QoS 0 (client MQTT 3.1.1 tối thiểu, payload như MockPubSub của runtime: chuỗi giữ nguyên, giá trị khác JSON). Kiểm live với mosquitto.
- **2026-10-07 — §7 cụ thể hoá bởi [ADR-0047](ADR-0047-kuksa-val-v2-migration.md) (Proposed):** databroker 0.7.0 đã xoá `sdv.databroker.v1` ⇒ giữ 0.5.0, chuyển từng backend sang `kuksa.val.v2` (signal-gateway làm provider), rồi mới nâng. Spike: `docs/spikes/kuksa-val-v2/`.

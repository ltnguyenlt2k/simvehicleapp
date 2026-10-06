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

# Spike — `kuksa.val.v2` trên databroker 0.5.0 (M14 #5, ADR-0047)

> Ngày: 2026-10-07 · Claude Code (theo uỷ quyền PO 2026-10-06). Mã: [`main.rs`](main.rs), [`Cargo.toml`](Cargo.toml)
> (crate `kuksa-rust-sdk =0.2.2`, stub `kuksa_rust_sdk::v2_proto`, build offline trong `simvehicleapp/toolchain-rust:dev`
> với `Cargo.lock` của `vehicle-app-rust-template`).

## Cách chạy
Databroker dùng một lần, **không** đụng stack dev: `docker network create sv-spike-v2`;
`docker run -d --rm --name sv-spike-vdb --network sv-spike-v2 -v …/vss_rel_4.0.json:/vss.json:ro
ghcr.io/eclipse-kuksa/kuksa-databroker:0.5.0 --insecure --enable-databroker-v1 --vss /vss.json` (đúng cờ của stack);
rồi `cargo run --offline` trong image toolchain-rust trên cùng network.

## Kết quả (nguyên văn output)
```
1 server: databroker 0.5.0
2 get_value hazard (never set): Ok(Some(Datapoint { timestamp: Some(…), value: None }))
3 actuate without provider: Err((Unavailable, "Provider for vss_id 65 does not exist"))
4 actuate a sensor: Err(InvalidArgument)
5 provide_actuation: Some(Ok(true))
6 second provider for the same actuator: Some(Err(AlreadyExists))
  provider got actuation Some(Id(65)) = Some(Bool(true))
7 actuate with provider: Ok("ok") in 0 ms
  provider publish_value current: Ok("ok")
8 get_value hazard after actuation: Ok(Some(Bool(true)))
```

## Rút ra
1. Databroker 0.5.0 phục vụ **đồng thời** `sdv.databroker.v1` (cờ `--enable-databroker-v1`), `kuksa.val.v1` và
   `kuksa.val.v2` ⇒ chuyển từng backend sang v2 được mà không đổi image.
2. `Actuate` v2 **cần provider**: không có ⇒ `UNAVAILABLE`. OK của `Actuate` = đã chuyển cho provider (0 ms), **không**
   phải giá trị current đã đổi; current đổi khi provider `PublishValue`.
3. Provider nhận actuation theo **id số** (`Id(65)`), không theo path ⇒ provider phải tra id ↔ path (`ListMetadata`).
4. Mỗi actuator chỉ một provider (`ALREADY_EXISTS`) ⇒ signal-gateway (vai provider của stack dev) và một provider thật
   (mock-provider, ECU) không cùng giữ một actuator.
5. Ghi sensor bằng `Actuate` ⇒ `INVALID_ARGUMENT` (app không ghi sensor — khớp `VEHICLE_WRITE_READ_ONLY` của compiler).

## Upstream (kiểm online 2026-10-07)
- `kuksa-databroker`: mới nhất **0.7.1** (2026-08-26). **0.7.0 (2026-07-03) xoá `sdv.databroker.v1`** ("Remove
  deprecated sdv.v1 API code", PR #211); `main.rs@0.7.1` chỉ còn `Api::KuksaValV1, Api::KuksaValV2`, không còn cờ
  `--enable-databroker-v1`. 0.6.1 sửa lỗi bảo mật `OpenProviderStream` (client chỉ có scope đọc đăng ký được làm
  provider) — chỉ khai thác được khi bật JWT; stack dev chạy `--insecure`, bind `127.0.0.1`.
- `kuksa-rust-sdk`: 0.2.2 vẫn là mới nhất (có stub v2).
- `vehicle-app-python-sdk`: mới nhất v0.15.7 (đang pin) — chỉ proto `sdv/databroker/v1`.
- `kuksa-python-sdk` (`kuksa-client`) 0.6.0: có stub `kuksa.val.v2` (`kuksa_client/grpc/__init__.py` import
  `kuksa.val.v2.val_pb2_grpc`).

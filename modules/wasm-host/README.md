# wasm-host — `sv-wasm-host`

Host của vehicle app SimVehicleApp build cho target WebAssembly ([ADR-0061](../../analysis/adr/ADR-0061-wasm-targets-cpp-rust-and-host-runtime.md), M20).

- Guest: module `wasm32-wasip1` dạng reactor, nói ABI [`sv-wasm-abi/1`](../simvehicleapp-contracts/abi/sv-wasm-abi.v1.md).
- Host: Wasmtime 48.0.7 (LTS). Mỗi lần gọi export có hạn thời gian (epoch, mặc định 200 ms, `SV_WASM_DEADLINE_MS`) và giới hạn bộ nhớ (mặc định 64 MiB, `SV_WASM_MAX_MEMORY_MB`).
  - Vượt hạn ⇒ trace `error` `wasm_limit`; trap ⇒ `wasm_trap`. Cả hai làm app dừng với mã khác 0.
- Allowlist `sv-app.json` (generator sinh ra) chặn đọc/ghi tín hiệu và topic ngoài danh sách (`forbidden`).

```bash
sv-wasm-host --precompile app.wasm app.cwasm          # .cwasm chỉ hợp lệ với đúng bản host này
sv-wasm-host --test app.cwasm cases.json [sv-app.json] # exit code = số case FAIL
sv-wasm-host app.cwasm sv-app.json                     # chạy trên databroker + MQTT (M20-T03b)
```

Kiểm tra (trong image Rust đã pin, như CI):
```bash
docker run --rm -v "$PWD":/src:ro rust:1.98.1-slim-bookworm bash -c 'cp -r /src /tmp/w && cd /tmp/w && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test'
```

Chạy trên stack: `SDV_VEHICLEDATABROKER_ADDRESS` (mặc định `grpc://127.0.0.1:55555`, chỉ `kuksa.val.v2`), `SDV_MQTT_ADDRESS`, `SV_TRACE_LEVEL` — như app native. Gate trên stack dev: `gate/live.sh` (cần `cargo build --release`).

Image: `docker build -t simvehicleapp/wasm-host:dev modules/wasm-host` (94 MB). `toolchain-wasm` và image deploy của app WASM sẽ copy binary từ image này (M20-T06).

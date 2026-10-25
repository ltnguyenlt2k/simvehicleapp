# Vehicle app dạng WebAssembly (C++ và Rust)

> M20, [ADR-0061](../../analysis/adr/ADR-0061-wasm-targets-cpp-rust-and-host-runtime.md) (Proposed — chờ PO xác nhận).

Cùng một workflow có thể thành app Velocitas native như trước, hoặc thành **một module WebAssembly** (`wasm32-wasip1`) chạy trong `sv-wasm-host`. Host nối app với KUKSA databroker (`kuksa.val.v2`) và MQTT, và giữ app trong giới hạn:
- bộ nhớ: mặc định 64 MiB;
- thời gian mỗi lần gọi: mặc định 200 ms;
- danh sách tín hiệu và topic được phép (`sv-app.json`, sinh khi SynCode). Đọc/ghi ngoài danh sách bị từ chối (`forbidden`).

App WASM nhỏ (GW-A: C++ khoảng 1 MB, Rust khoảng 350 KB). Image deploy khoảng 9 MB.

## Bật trên stack
Thêm profile `wasm` và hai backend/toolchain vào `.env` (cần cả profile `rust`, vì `codegen-rust` cũng là backend của `rust-wasm`):

```bash
COMPOSE_PROFILES=python,rust,wasm
SV_BACKENDS=cpp=http://codegen-cpp:4110,…,cpp-wasm=http://codegen-cpp:4110/wasm,rust-wasm=http://codegen-rust:4130/wasm
SV_TOOLCHAINS=cpp=http://toolchain-cpp:4210,…,cpp-wasm=http://toolchain-wasm:4240,rust-wasm=http://toolchain-wasm:4240
```

Rồi `scripts/sv build` (build thêm `wasm-host` và `toolchain-wasm`) và `scripts/sv up`. Trang **System status** hiện `codegen-cpp-wasm`, `toolchain-cpp-wasm`, … ở trạng thái `ok`.

## Tạo app WebAssembly
1. **Vehicle apps** (hoặc hộp thoại khi bấm SynCode lần đầu): chọn **Language** C++ hoặc Rust.
2. Ô **Runtime** hiện ra khi stack có backend và toolchain WebAssembly của ngôn ngữ đó. Chọn **WebAssembly (sv-wasm-host)**.
3. Thẻ app ghi `C++ · WebAssembly` (hoặc `Rust · WebAssembly`).

Python chưa có target WebAssembly.

## Dùng như app native
- **SynCode:** sinh cùng mã workflow như native, rồi build ra `build/app.wasm` và `build/app.cwasm` (đã biên dịch sẵn cho host). Test case lưu với workflow chạy ngay trong module (`sv-wasm-host --test`).
- **Run, tab Live, Flow, Play:** như app native. App WASM luôn dùng `kuksa.val.v2`.
- **Export:** zip có mã nguồn, `CMakeLists.txt` (C++) hoặc `Cargo.toml` (Rust), `sv-app.json`, và README hướng dẫn build bằng wasi-sdk-34 hoặc `cargo --target wasm32-wasip1`, chạy bằng `sv-wasm-host`.
- **Deploy → Container image:** image `FROM scratch` gồm `sv-wasm-host`, `app.cwasm` và `sv-app.json`, push không cần Docker.

## Chạy tay ngoài SimVehicleApp
```bash
sv-wasm-host --precompile build/app.wasm build/app.cwasm
sv-wasm-host --test build/app.cwasm app/tests/generated/cases.json
SDV_VEHICLEDATABROKER_ADDRESS=grpc://127.0.0.1:55555 SDV_MQTT_ADDRESS=mqtt://127.0.0.1:1883 \
  sv-wasm-host build/app.cwasm app/src/generated/sv-app.json
```
`.cwasm` chỉ hợp lệ với đúng bản `sv-wasm-host` đã biên dịch nó. Đổi bản host thì chạy lại `--precompile` (hoặc chạy thẳng `.wasm`).

Biến môi trường: `SV_WASM_MAX_MEMORY_MB` (mặc định 64), `SV_WASM_DEADLINE_MS` (mặc định 200), `SV_TRACE_LEVEL`.

## Giới hạn hiện tại
- Runtime C++ dùng exception-handling của WebAssembly (`-fwasm-exceptions`): chạy trên Wasmtime; chưa kiểm với WAMR/`iwasm` trên ECU.
- Chưa có IDE (code-server) riêng cho project WASM.

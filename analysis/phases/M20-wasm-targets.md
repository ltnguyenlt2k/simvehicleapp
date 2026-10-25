# M20: Target WebAssembly cho C++ và Rust + host runtime `sv-wasm-host`

> **Yêu cầu:** PO 2026-10-24 — "thêm compiler ngôn ngữ cho CPP + wasm + wasmruntime" và "rust + wasm + wasmruntime".
> **Thiết kế:** [docs/design/M20-wasm-targets.md](../../docs/design/M20-wasm-targets.md) (§2 dữ kiện nguồn, §3 kiến trúc và ABI).
> **ADR:** [0061](../adr/ADR-0061-wasm-targets-cpp-rust-and-host-runtime.md) (Proposed — chờ PO xác nhận).
> **Phụ thuộc:**
> - M6 (backend C++), M13 (backend Rust), ADR-0047 (`kuksa.val.v2`), ADR-0057 (sandbox run).
> - M19-T02 (`data.eval` trong trace): runtime WASM phát `eval` ngay từ đầu.
> - Gate M18 (và M19 nếu làm trước) PASS trước khi tick M20 (luật cứng 7). Spike T01 không phụ thuộc, làm được sớm.
>
> **Nguyên tắc:**
> - cùng emitter cho native và wasm (không fork generator);
> - golden native không đổi byte;
> - conformance và parity bắt buộc cho `cpp-wasm` và `rust-wasm`;
> - mọi thay đổi người dùng thấy phải làm đủ AGENTS.md §4 bước 7–8.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | **Spike**: guest reactor C++ (wasi-sdk-34, `-fno-exceptions`) + Rust (`wasm32-wasip1`) gọi import `sv.*`; chạy trên Wasmtime LTS v48 và `iwasm` 2.4.5; đo kích thước/thời gian khởi động; chốt pin | spikes | — | `docs/spikes/M20-wasm-spike.md` có số đo + pin; ADR-0061 Notes |
| T02 | Contract: ABI `sv-wasm-abi/1` (`contracts/abi/`), `backend-capabilities` thêm `target`, `generation-manifest.target`, `Project.target` | contracts, orchestrator | T01 | Additive + CHANGELOG; contract test; project cũ = `velocitas` |
| T03 | `modules/wasm-host`: Wasmtime, KUKSA v2, MQTT, SVTRACE, allowlist `sv-app.json`, giới hạn bộ nhớ/CPU, `--test`, `--precompile`; image | wasm-host (mới) | T02 | Unit + test tích hợp với databroker thật; host không crash khi guest lỗi/vượt giới hạn |
| T04 | C++: `SV_RT_NO_EXCEPTIONS`, `Strand::pump`, adapter Wasm; generator target `wasm` (`main_wasm.cpp`, CMake, `sv-app.json`); template `wasm-app-cpp`; golden `golden-wasm` | compiler-code-cpp | T02, T03 | Golden native không đổi; golden wasm tất định; build trong toolchain-wasm |
| T05 | Rust: feature `wasm`; generator target `wasm` (cdylib); template `wasm-app-rust`; golden `golden-wasm` | compiler-code-rust | T02, T03 | Như T04 |
| T06 | `toolchain-wasm` (wasi-sdk-34, rust + `wasm32-wasip1`, wasm-tools, host) + plan build/test/run trong agent + profile compose `wasm` + `SV_BACKENDS` | velocitas-stack | T03 | Compose valid độc lập; image build trên CI; job build/test/run PASS |
| T07 | Orchestrator/studio: chọn target khi tạo project, nhãn target, Run qua host, Export WASM, Deploy image (ADR-0060) | orchestrator, studio | T04–T06 | Vitest + E2E mock; unit orchestrator |
| T08 | Conformance C01–C45, parity P3 (`kuksa.val.v2`), tái lập `app.wasm`, an toàn (allowlist/giới hạn), đo hiệu năng so với native | compiler-code-*, gate | T04–T07 | 45/45 ×2; P3 7/7 ×2; số đo trong báo cáo |
| T09 | Đóng milestone: gate, full luồng `@live` với project WASM (C++ và Rust), video, README + user guide (`docs/user-guide/wasm.md`), báo cáo M20 | all, docs | T08 | CI + nightly xanh; `docs/reports/M20.md` |

## Checklist chi tiết

### T01: Spike
- [x] C++ reactor: `-mexec-model=reactor`, export `sv_init/sv_step`, import `sv.now_ms/log`; build bằng wasi-sdk-34 với `-fno-exceptions`.
- [x] Rust cdylib `wasm32-wasip1`: cùng ABI tối thiểu.
- [x] Chạy trên Wasmtime v48.0.7 (host tối thiểu bằng **C API**, link tĩnh, thay cho crate Rust để khỏi biên dịch Wasmtime trên máy 11 GB). `iwasm` 2.4.5: **chưa làm**, dời sang quyết định ở T04.
- [x] Biên dịch thử runtime C++ bằng wasi-sdk: `-fno-exceptions` ⇒ 25 lỗi `try`/`throw` ở `Runtime.cpp`, các file khác sạch; `-fwasm-exceptions` ⇒ sạch, guest bắt exception chạy đúng. Thread của `Strand` cần `Strand::pump` (T04).
- [x] Đo kích thước/nạp/`.cwasm` (bảng §2 của báo cáo spike); pin ghi vào `00-research-findings.md` §1.
- Bằng chứng: [docs/spikes/M20-wasm-spike.md](../../docs/spikes/M20-wasm-spike.md), `spikes/m20-wasm/run.sh`.

### T02: Contract
- [x] `contracts/abi/sv-wasm-abi.v1.md` (import/export, mã hoá JSON, bất biến không tái nhập, mã lỗi, giới hạn, allowlist, `.cwasm` do host biên dịch) + `sv-wasm-abi.v1.wit` tham khảo; thêm vào `CONTRACT.md`, `package.json` (`abi`), Dockerfile.
- [x] `backend-capabilities`: `$defs.target {kind velocitas|wasm, triple, abi, host}`; `kind = wasm` bắt buộc `triple`, `abi`, `host`. Điều kiện template (`toolchain-wasm`) kiểm ở T04/T05 khi có backend thật.
- [x] `generation-manifest.target`; `Project.target` (OpenAPI orchestrator, repo, migration `0005_sv_project_target.sql` mặc định `velocitas`, studio `sv.ts`). Tạo project `target: wasm` khi `SV_BACKENDS` chưa có `<language>-wasm` ⇒ 422 `BACKEND_UNAVAILABLE` (mã có sẵn).
- Bằng chứng 2026-10-25: contracts `bun test` 400/400 + `check`; orchestrator tsc sạch, `bun test` 133 pass (5 test workspace FAIL do `tar` trong thư mục tạm của máy này, như trước); studio vitest 311.

### T03: Host
Chia **T03a** (lõi) và **T03b** (databroker, MQTT, chế độ run, image); cả hai xong 2026-10-25.
- [x] Vòng lặp sự kiện + epoch deadline + `ResourceLimiter`; mã lỗi/trace `wasm_limit` (và `wasm_trap`) — T03a: `Host`, `pump`, `Ticker` 10 ms, `StoreLimits`.
- [x] KUKSA v2 (`kuksa-rust-sdk =0.2.2`, như runtime Rust): subscribe tự kết nối lại sau 2,5 s, giá trị đầu đánh dấu `initial` (baseline), chờ tối đa 2 s trước `app.started`; ghi = `Actuate`; MQTT `rumqttc` với filter `+`/`#`.
- [x] Env giống app native (`SDV_VEHICLEDATABROKER_ADDRESS`, `SDV_MQTT_ADDRESS`, `SV_TRACE_LEVEL`); sandbox ADR-0057 chỉ đổi địa chỉ databroker nên dùng được, kiểm khi orchestrator chạy app WASM (T07).
- [x] Allowlist path/topic từ `sv-app.json`; `forbidden` — T03a (`allow.rs`; `vdb_set` ngoài danh sách ⇒ `set_result` `forbidden`, đọc ⇒ `-2`).
- [x] `--test` (gọi `sv_run_tests`, in kết quả, exit code = số FAIL), `--precompile` — T03a.
- Bằng chứng T03b: `cargo test` 6/6 (thêm đổi giá trị v2 ⇄ JSON có kiểm miền `uint8`…, match topic MQTT); `gate/live.sh` trên databroker 0.5.0 thật: giá trị đầu `initial`, thay đổi từ signal-gateway tới guest, `vdb.connected`/`app.started`, `set_result` ("Provider … does not exist" khi không có run); image 94 MB build được.
- Bằng chứng T03a: `modules/wasm-host` `cargo test` 4/4 (guest WAT: import + allowlist + cache `vdb_current` + trace `SVTRACE`; quá hạn ⇒ `wasm_limit`; trap ⇒ `wasm_trap`; `memory.grow` quá 64 MiB ⇒ `-1`; `.cwasm` của engine khác bị từ chối; thiếu export ⇒ báo tên); rustfmt + clippy `-D warnings` sạch; job CI `wasm-host` mới.

### T04 / T05: Backend
- [x] Target được chọn qua base URL `/wasm` của service generator; `GET /wasm/capabilities` có `target` (C++: `backend.wasm.yaml` thay `id`, `toolchain`, thêm `target`).
- [x] Cùng emitter: diff `src/generated/**` giữa native và wasm chỉ ở phần adapter/entry đã khai báo (C++: test kiểm `workflows/**`, `sourcemap/**` giống hệt; chỉ wasm có `MainWasm.cpp`, `sv-app.json`, `tests/generated/cases.json`).
- [ ] Runtime: adapter Wasm, Strand bơm (C++), không exception (C++), feature `wasm` (Rust); test runtime native vẫn xanh.
  - **C++ (2026-10-25, phần runtime):** `include/simvehicleapp/rt/Wasm.hpp` + `src/Wasm.cpp` (export `sv_*`, `HostVehicle`/`HostPubSub`/`HostSink` qua import `sv.*`, `sv_run_tests` dùng `testing::runScenario` + `checkExpectations`). Strand dùng đồng hồ ảo do `sv_step` đẩy, thêm `Strand::nextDueMs()`. `Runtime::signals()` để subscribe trước `start`. Exception giữ lại, build bằng `-fwasm-exceptions` (theo spike, chờ PO). Bằng chứng:
    - GW-A (workflow sinh ra + runtime + `MainWasm.cpp` viết tay) biên dịch bằng wasi-sdk-34: 1,07 MB sau strip, `.cwasm` 2,7 MB.
    - `sv-wasm-host --test`: case golden PASS, case sai FAIL với đúng diff, exit 1.
    - Chạy live trên databroker thật: trigger 130 với `previous` 100 (baseline đúng), `stable` + `eval` sau 2 s, write, publish HMI, `app.stopping`.
    - gtest native 19/19, golden generator không đổi.
  - **C++ generator + template (2026-10-25):** target `wasm` (`/wasm/*`), golden `golden-wasm/GW-A…G` tất định, template `velocitas-stack/templates/wasm-app-cpp` (CMake wasi-sdk, user hooks). Bảy golden wasm biên dịch bằng wasi-sdk-34 và đạt `expected.writes` của golden trong guest (`sv-wasm-host --test`, 7/7 PASS); generator `bun test` 24/24.
  - **Rust (2026-10-25):** runtime feature `wasm` (`src/wasm.rs`: export qua macro `wasm_app!` sinh trong crate app, adapter host, `run_tests`; import có bản giả cho test native) + `Strand::next_due_ms`; generator target `/wasm` (`wasm.rs`, `sv-app.json`, `cases.json`; `app.rs`/`workflows/**` giống native); template `velocitas-stack/templates/wasm-app-rust` (cdylib, `Cargo.lock` để build offline); `golden-wasm` GW-A…G. Bằng chứng:
    - bảy golden build `wasm32-wasip1` offline, khoảng 345 KB mỗi app, và đạt `expected.writes` trên `sv-wasm-host --test` (7/7);
    - runtime: clippy `-D warnings` sạch có và không có feature `wasm`, test 8/8;
    - generator `bun test` 26/26, golden native không đổi.
  - Host sửa: chờ giá trị đầu xong mới gửi `start` (rút hết event đang xếp hàng); thiếu bước này thì `previous` thành `null`.
- [x] Test sinh ra: test case nhúng JSON ⇒ `sv_run_tests` (C++: `cases.json` `[{name, workflow, scenario}]`, mỗi case chỉ bind workflow của nó như test native).

### T06: Toolchain
- [ ] Image `toolchain-wasm` (pin sha256 tarball wasi-sdk; rustup target), agent plan build/test/run; profile `wasm`.
- [ ] RAM/đĩa đo và ghi (máy dev 11 GB; build image trên CI theo ADR-0051).

### T07: Studio/orchestrator
- [ ] Tạo project: "Runtime: Velocitas (native) / WebAssembly"; Vehicle apps hiện target.
- [ ] Run, Signals, Test/Play, Flow chạy như native.
- [ ] Export: source + build files + `sv-app.json` + README chạy bằng `sv-wasm-host`; NOTICE có Wasmtime/wasi-sdk.
- [ ] Deploy image `FROM simvehicleapp/wasm-host`.

### T09: Đóng milestone
- [ ] Gate M20; full luồng `@live` cho project WASM C++ và Rust; quay lại video.
- [ ] README chính + `docs/user-guide/wasm.md`; `docs/reports/M20.md`; ROADMAP; CHANGELOG; `sv refresh`.

## Acceptance gate
1. Cùng một workflow ⇒ SynCode ra app C++→WASM và Rust→WASM; Run trên stack bằng `sv-wasm-host`; inject ⇒ actuator đổi; Flow hiện đủ luồng.
2. Conformance C01–C45 PASS cho `cpp-wasm` và `rust-wasm`; parity P3 7/7 trên `kuksa.val.v2`.
3. Generate và build tất định; golden native không đổi.
4. Host chặn path/topic ngoài allowlist và giới hạn bộ nhớ/CPU mà không crash.
5. Số đo kích thước/RSS/độ trễ so với native được ghi; CI + nightly xanh; full luồng `@live`, video và README cập nhật.

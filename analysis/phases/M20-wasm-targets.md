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
- [ ] `contracts/abi/sv-wasm-abi.v1.md` (import/export, mã hoá JSON, bất biến không tái nhập, lỗi) + WIT tham khảo.
- [ ] `backend-capabilities`: `target {kind, triple, abi, host}`; điều kiện template khi `kind = wasm`.
- [ ] `generation-manifest.target`; `Project.target` (orchestrator repo, studio contract `sv.ts`); migration mặc định `velocitas`.

### T03: Host
- [ ] Vòng lặp sự kiện + epoch deadline + `ResourceLimiter`; mã lỗi/trace `wasm_limit`.
- [ ] KUKSA v2 (proto vendored trong module) với `waitForReady`/kết nối lại; MQTT.
- [ ] Env giống app native; chạy được trong sandbox ADR-0057.
- [ ] Allowlist path/topic từ `sv-app.json`; `forbidden`.
- [ ] `--test` (gọi `sv_run_tests`, in kết quả, exit code = số FAIL), `--precompile`.

### T04 / T05: Backend
- [ ] Target được chọn qua base URL `/wasm` của service generator; `GET /wasm/capabilities` có `target`.
- [ ] Cùng emitter: diff `src/generated/**` giữa native và wasm chỉ ở phần adapter/entry đã khai báo.
- [ ] Runtime: adapter Wasm, Strand bơm (C++), không exception (C++), feature `wasm` (Rust); test runtime native vẫn xanh.
- [ ] Test sinh ra: test case nhúng JSON ⇒ `sv_run_tests`.

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

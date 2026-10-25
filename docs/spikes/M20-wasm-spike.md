# Spike M20-T01 — guest WASM C++/Rust trên Wasmtime v48

> Ngày: 2026-10-24 · Agent: Claude Code · ADR: [0061](../../analysis/adr/ADR-0061-wasm-targets-cpp-rust-and-host-runtime.md) (Proposed)
> Mã spike: [`spikes/m20-wasm/`](../../spikes/m20-wasm/) — `run.sh` chạy mọi bước trong container. Tarball được kiểm sha256; image đã pin.

## 1. Kết quả chính
- **ABI tối thiểu chạy được** với cả hai ngôn ngữ trên Wasmtime v48.0.7:
  - guest import `sv.now_ms() -> i64`, `sv.log(ptr, len)`;
  - guest export `sv_init() -> i32`, `sv_step(now: i64) -> i32` và `memory`;
  - guest C++ là *reactor* (`-mexec-model=reactor`): host gọi `_initialize` trước, để chạy các constructor.
- **Host tối thiểu dùng C API của Wasmtime** (`wasmtime-v48.0.7-x86_64-linux-c-api`, link tĩnh): không phải biên dịch crate `wasmtime` (nặng với máy dev 11 GB). Hướng cho T03: Rust + crate `wasmtime` vẫn là lựa chọn cho `sv-wasm-host`; C API là phương án dự phòng nhẹ.
- **`.cwasm` phải do chính host biên dịch** (`host --precompile`). `wasmtime compile` của CLI tạo module cho *copying collector*, còn engine mặc định của C API dùng *deferred reference-counting* ⇒ nạp bị từ chối. `sv-wasm-host --precompile` (T03) phải dùng cùng cấu hình engine với lúc chạy.
- **Runtime C++ hiện tại biên dịch được bằng wasi-sdk-34:**
  - với `-fno-exceptions`: chỉ `Runtime.cpp` lỗi — 25 lỗi, đều là `try`/`throw` (19 `try`, 6 `throw`, quanh `EvalError`). `Value.cpp`, `Strand.cpp`, `Testing.cpp` biên dịch sạch;
  - với `-fwasm-exceptions` (exception-handling proposal mới, `-mllvm -wasm-use-legacy-eh=false`, link thêm `-lunwind`): cả 4 file biên dịch sạch. Guest có `throw`/`catch` chạy đúng trên Wasmtime v48 (bắt được `EvalError`, 0,41 µs/bước).
  - ⇒ **Đề xuất cho T04 (chờ PO xác nhận):** dùng `-fwasm-exceptions` thay vì viết lại `EvalError` thành mã lỗi (`SV_RT_NO_EXCEPTIONS` như ADR-0061 dự kiến). Ít sửa runtime hơn. Đổi lại, host phải bật exception-handling (Wasmtime v48 chạy được), và WAMR/`iwasm` trên ECU phải hỗ trợ EH — chưa kiểm.
  - Chưa link toàn bộ runtime: `Strand` dùng `std::thread`/`condition_variable`, `wasm32-wasip1` không có thread. Việc của T04 là `Strand::pump` (host bơm sự kiện) theo ADR-0061.

## 2. Số đo (Wasmtime v48.0.7, WSL2, 1 lần đo, µs)
| Guest | `.wasm` gốc | sau `wasm-tools strip` | `.cwasm` | biên dịch `.cwasm` | nạp `.wasm` (JIT) | nạp `.cwasm` | instantiate | `sv_step` trung bình (10 000 bước) |
|---|---|---|---|---|---|---|---|---|
| C++ (`-Os`, `-fno-exceptions`) | 685 853 B | 53 769 B | 135 008 B | 17 032 | 15 791–17 740 | 266–269 | 179–197 | 0,69 |
| C++ có EH (`-fwasm-exceptions`) | — | 51 605 B | — | — | 16 543 | — | 175 | 0,41 |
| Rust (`opt-level="s"`, LTO, `panic=abort`) | 58 803 B | 58 803 B | 172 080 B | 15 983 | 13 279–14 858 | 232–361 | 150–175 | 0,38–0,47 |

Host C tĩnh: 35,7 MB (chưa strip; gồm cả Cranelift). Nhận xét:
- nạp `.cwasm` nhanh hơn JIT khoảng 60 lần (≈0,3 ms so với ≈15 ms) ⇒ image Deploy (ADR-0060) nên chứa `.cwasm`;
- guest nhỏ (≈55 KB sau strip) cho cả hai ngôn ngữ.

## 3. Pin đã chốt (đã kiểm release + sha256 ngày 2026-10-24)
| Thành phần | Pin | Asset / sha256 |
|---|---|---|
| wasi-sdk | `wasi-sdk-34` (clang 23.1.0) | `wasi-sdk-34.0-x86_64-linux.tar.gz` · `b761e3a0…84b2c4` |
| Wasmtime | `v48.0.7` (LTS) | C API `…-c-api.tar.xz` · `3d65ab7a…ee3719`; CLI `…-linux.tar.xz` · `2192e2b5…dd0f45` |
| wasm-tools | `v1.262.0` | `wasm-tools-1.262.0-x86_64-linux.tar.gz` · `655b8df6…a9ed65` |
| Rust | `rust:1.98.1-slim-bookworm` + target `wasm32-wasip1` | image đã pin trong CI |

## 4. Chưa làm trong spike (đưa sang task sau)
- **`iwasm` 2.4.5** (WAMR, native symbol stub): chưa build. Chỉ cần cho hướng ECU sau v1, và phải kiểm thêm EH nếu chọn `-fwasm-exceptions`. Ghi lại để quyết định ở T04.
- Guest Rust dùng runtime Rust thật (feature `wasm`): T05.
- Giới hạn bộ nhớ/CPU (epoch, `ResourceLimiter`): T03.

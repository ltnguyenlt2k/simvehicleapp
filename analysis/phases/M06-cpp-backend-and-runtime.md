# M6 — Runtime C++ + `compiler-code-cpp`

**Mục tiêu:** IR → C++ tất định; runtime pass conformance với MockVehicle; golden C++ build thật được trong toolchain image.
**ADR:** 0020, 0021, 0022 · **Phụ thuộc:** M0 (runtime bắt đầu song song, M6a), M4 (codegen) · Master Plan Phase 14–15

## A. Runtime (`compiler-code-cpp/runtime`) — bắt đầu ngay sau M0
| ID | Task | Test |
|---|---|---|
| M06-T01 | CMake/Conan 2 package độc lập cho runtime (link vehicle-app-sdk 0.7.1) build trong toolchain image | CI build |
| M06-T02 | `IClock`, `SteadyClock`, `testing::VirtualClock`; `Strand` (queue + timer heap, post/postAt/cancel) | gtest; TSAN |
| M06-T03 | `IVehicleAccess` + `VelocitasVehicleAccess` (subscribe gộp theo path, get async, set, setMany; tham chiếu `examples/set-data-points`, `SampleApp`) | integration với databroker (nightly) |
| M06-T04 | `testing::MockVehicle` (inject, writes log) | gtest |
| M06-T05 | `Runtime` (signal registry + cache, onAppStart/onSignalChanged(mode, debounce)/onTimer/onMqtt), policies, cancel token, stop scopes | conformance |
| M06-T06 | `Ctx` read/write/writeMany/wait/waitUntil/stableFor/publish/log/trace/stop | conformance |
| M06-T07 | `StateVar<T>`, counter; loop helpers (repeat/while với guard + yield) | conformance |
| M06-T08 | `Tracer` (`SVTRACE` JSON 1 dòng, level env), `AppBase : velocitas::VehicleApp` | golden trace |
| M06-T09 | Conformance runner C++: đọc `scenario.yaml` + IR-free fixture (workflow C++ viết tay tương ứng) → so trace | 100% scenarios |
| M06-T10 | `docs/RUNTIME_API.md` (Doxygen → md) | |

## B. Generator (`compiler-code-cpp/generator`)
| ID | Task | Test |
|---|---|---|
| M06-T11 | Server `/capabilities` `/generate` `/runtime/files` `/template-overlay/files` + backend.yaml | contract test |
| M06-T12 | `CodeWriter` (indent theo .clang-format template, line tracking → source map), `cppString`, `sanitizeIdent` | unit + fuzz |
| M06-T13 | Naming tất định (class/file/method), VSS path → member expression, VSS type → C++ type | unit |
| M06-T14 | Emitters P0: triggers, vehicle.read/write, control.branch/wait/stable_for/stop, state, comm.log/mqtt_publish, `$expr` | golden GW-A,B,E |
| M06-T15 | Emitters P1: switch, wait_until, repeat, while, parallel, condition, write_many | golden GW-C,D,F,G |
| M06-T16 | Project files: `SimVehicleApp.*`, `Main.cpp`, `generated.cmake`, `simvehicleapp.gen.json`, sourcemaps | golden |
| M06-T17 | Template overlay (xoá SampleApp/Launcher/test sample; `app/src/CMakeLists.txt` mới; `user/UserHooks.*`) | build thật |
| M06-T18 | Tests sinh kèm `app/tests/generated/*_test.cpp` từ scenario | ctest trong toolchain |
| M06-T19 | Manifest fragment builder | unit |
| M06-T20 | Determinism test (2 lần, 2 OS runner) | CI |
| M06-T21 | ~~Spike nhỏ: keyword C++ trong segment VSS; `.clang-format` template~~ — **đã đóng trước khi tới M6** (nghiên cứu 2026-10-01, xem [ADR-0022 Notes](../adr/ADR-0022-cpp-codegen-strategy.md)): không cần escape keyword, `.clang-format` thật đã biết (`IndentWidth:4, ColumnLimit:100, BreakBeforeBraces:Attach, PointerAlignment:Left,...`). Việc còn lại ở M6 chỉ là áp dụng thẳng vào `CodeWriter`, không cần spike lại. | — |

## Gate
- Runtime: conformance 100%, TSAN sạch.
- Golden C++ GW-A..G diff = 0; build thật bằng toolchain image (thủ công: copy vào project từ template, `./build.sh`) cho GW-A..E; generated tests pass.
- Không có egress mạng từ container codegen (compose network internal).

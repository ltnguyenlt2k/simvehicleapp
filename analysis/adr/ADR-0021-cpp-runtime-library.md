# ADR-0021: Runtime C++ `simvehicleapp-runtime-cpp` — strand, policies, trace, cô lập SDK

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L1
- **Related:** FR-CG-06; Master Plan 3.4, 8.1, 8.2, 8.7, ADR-005 cũ; [04 §3](../04-velocitas-deep-dive.md#3-vấn-đề-đồng-thời-trong-c-sdk--giải-pháp); [07 §4](../07-codegen-backends.md#4-runtime-c-simvehicleapp-runtime-cpp--api-công-khai-v01)

## Context
SDK 0.7.1: callback trên thread gRPC/ThreadPool; `get()->await()` chặn; subscribe theo query string; typed datapoints từ vehicle model. Generated code phải nhỏ; runtime phải ổn định, test được không cần databroker.

## Decision
1. Thư viện C++17 header+source, namespace `simvehicleapp::rt`, API như [07 §4](../07-codegen-backends.md#4-runtime-c-simvehicleapp-runtime-cpp--api-công-khai-v01).
2. **Strand** 1 thread (queue + timer min-heap trên `IClock`); mọi callback SDK chỉ `post`. Không `await()` trên strand.
3. **Adapter** `IVehicleAccess` (interface) với 2 impl: `VelocitasVehicleAccess` (dùng `VehicleApp` protected API + `TypedDataPoint<T>::get/set`, `setMany`, `subscribeDataPoints(QueryBuilder::select(dp).build())`) và `testing::MockVehicle`. Đây là nơi **duy nhất** gọi SDK ⇒ SDK đổi chỉ sửa 1 chỗ (R3).
4. `AppBase : velocitas::VehicleApp` dựng `IVehicleDataBrokerClient::createInstance("vehicledatabroker")` + `IPubSubClient::createInstance(appName)` như template.
5. Subscription gộp theo path; cache giá trị mới nhất (phục vụ `<Vehicle.Path>` reporter).
6. Policies restart/ignore/queue/parallel, cancel token, stop scopes, loop guard — đúng ADR-0012.
7. Trace: `SVTRACE ` + JSON 1 dòng ghi thẳng `stdout` qua mutex riêng của runtime (**không** qua `velocitas::logger()`, để format ổn định, không phụ thuộc cấu hình logger của SDK); mức chi tiết lấy từ env `SV_TRACE_LEVEL`.
8. **Versioning (thay ADR-005 cũ):** MVP **vendored** vào project (`app/src/simvehicleapp-runtime/`, có `VERSION`) ⇒ export tự chứa, build offline. P2: phát hành thêm Conan package `simvehicleapp-runtime/<ver>` (Conan 2) để project tham chiếu thay vì vendor; backend.yaml ghi runtime version; nâng runtime = commit có kiểm soát qua workspace.
9. Test: gtest với MockVehicle + VirtualClock; conformance scenarios chung.

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| Sinh toàn bộ logic timer/policy vào mỗi file | Trái nguyên tắc 3.4; bug nhân bản |
| Dùng `velocitas::ThreadPool`/`Job` trực tiếp | Đa luồng ⇒ race; khó virtual clock |
| Conan package ngay từ đầu | Cần registry Conan nội bộ, offline phức tạp hơn |

## Consequences
+ Code sinh ngắn, không lock; runtime test độc lập. − Logic nặng chặn strand (cảnh báo qua trace duration).

## Verification
Runtime CI: build Conan 2 trong toolchain image; unit + conformance 100%; TSAN build job không cảnh báo.

## Notes / Deviations (2026-10-07) — triển khai M6, theo uỷ quyền PO 2026-10-06, chờ PO xác nhận
Mục tiêu đo được: runtime + code sinh ra cho **trace trùng khớp tuyệt đối** với simulator (ADR-0042 P1) — bằng chứng `generator/conformance/conformance.sh`: 38 conformance + 7 golden 45/45 PASS (kể cả dưới ASan/UBSan), golden trace so từng event.
1. **Interpreter một chỗ thay vì sinh CPS cho từng node:** code sinh ra khai báo mỗi trigger/node IR bằng một câu lệnh builder (`rt::Workflow::write/stableFor/...`) với biểu thức là lambda có kiểu; runtime thực thi chain/run/fiber/policy/cancel/trace theo đúng mô hình simulator (ADR-0017 Notes §1–16). Lý do: thứ tự sự kiện cùng thời điểm, hủy, join, queue… chỉ cài một lần (đúng tinh thần §"Sinh toàn bộ logic timer/policy vào mỗi file" bị loại) và kiểm chứng được bằng conformance; API `Ctx::read/write/wait…` dạng continuation ở analysis/07 §4 được thay bằng builder (`Workflow`) + `Ctx` chỉ để đọc giá trị (`out/signal/state/nowMs`).
2. **Lõi không phụ thuộc SDK:** `Value/Strand/Runtime/Testing` build độc lập (C++17 + nlohmann_json, test gtest trong CI ubuntu); chỉ `Velocitas.cpp` (`VelocitasVehicleAccess`, `VelocitasPubSub`, `AppBase`) cần SDK và chỉ build trong project (`SV_RT_VELOCITAS=ON`).
3. **`IVehicleAccess` theo path** (`current/subscribe/get/checkWrite/set`) qua `IVehicleDataBrokerClient::getDatapoints/setDatapoints/subscribe("SELECT <path>")` của SDK 0.7.1 (đã đọc header/source đúng pin trong toolchain image) — không cần `TypedDataPoint` trong runtime; kiểm tra path/kiểu bằng model có kiểu chuyển sang host sinh ra (ADR-0022 Notes). Giá trị lúc khởi động = mốc (đọc `current` trước khi start, subscription lần đầu trùng mốc ⇒ không bắn).
4. **MQTT:** SDK chỉ trả payload theo subscription ⇒ message giao cho trigger có đúng filter đó (`onlyFilter`), trigger output `topic` = filter khi dùng wildcard (giới hạn của SDK). Mock giao theo topic như simulator.
5. **Trace:** dòng `SVTRACE` theo `trace-event#/$defs/runtimeLine` (`v, ts epoch, app, wf, run, node, ev, data`); orchestrator map `node`→`blockId`. Sự kiện hệ thống `vdb.connected`, `app.started`, `app.stopping`. Mức: `AppBase(appName, defaultLevel)` + env `SV_TRACE_LEVEL`.
6. **An toàn bộ nhớ app chạy lâu:** fiber bị hủy kết thúc ngay (ADR-0017 Notes §15), token con dọn định kỳ, vòng tham chiếu continuation được cắt lúc dừng — ASan/LSan sạch trên unit test + 45 case; TSAN sạch (GCC 11/13 cần `setarch -R` trên kernel ASLR cao).
7. **Version:** `runtime/VERSION` 0.1.0, vendored vào `app/src/simvehicleapp-runtime/` qua `GET /runtime/files` (§8 MVP); gói Conan để P2.

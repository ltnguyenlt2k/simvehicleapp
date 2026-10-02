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

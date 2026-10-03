---
name: velocitas-vehicle-app
description: Implement or validate Velocitas app generation, manifests, SDK adapters and headless build or run behavior.
---

# Velocitas Vehicle App — kiến thức thực hành

Tham chiếu: `analysis/04-velocitas-deep-dive.md`, `analysis/00-research-findings.md` §3, ADR-0021..0025.

## Template C++ (@275e858)
`.velocitas.json` (appManifestPath `app/AppManifest.json`, cliVersion v0.13.2, packages devenv-runtimes v4.1.0 / devcontainer-setup v3.0.0) · `conanfile.txt` (fmt 11.1.1, nlohmann_json 3.11.3, `vehicle-model/generated`, `vehicle-app-sdk/0.7.1`) · C++17 · target `app` trong `app/src` · gtest trong `app/tests/utests`.

## Lệnh
```bash
velocitas init -f -v && velocitas sync
./install_dependencies.sh [-r]        # velocitas exec build-system install
./build.sh [-r] [-t app] [--static]   # velocitas exec build-system build → build/bin/app
velocitas exec vehicle-signal-interface download-vspec && velocitas exec vehicle-signal-interface generate-model
./build/bin/app_utests --gtest_output=xml  # pinned template: ctest có thể không discover test
```
Headless (không devcontainer): chuỗi trong `app/Dockerfile` của template trên `ghcr.io/eclipse-velocitas/devcontainer-base-images/cpp:v0.4`; `VELOCITAS_OFFLINE=1` khi cache đã bake.

## Chạy app trên stack compose
```bash
SDV_MIDDLEWARE_TYPE=native SDV_VEHICLEDATABROKER_ADDRESS=grpc://databroker:55555 SDV_MQTT_ADDRESS=mqtt://mqtt:1883 ./build/bin/app
```
`KUKSA_DATABROKER_API` (C++ only): `sdv.databroker.v1` mặc định | `kuksa.val.v2` (set = Actuate, cần provider; không WHERE). Databroker 0.5.0 phải chạy với `--enable-databroker-v1`.

## API C++ SDK 0.7.1
```cpp
class App : public velocitas::VehicleApp {
  App() : VehicleApp(velocitas::IVehicleDataBrokerClient::createInstance("vehicledatabroker"),
                     velocitas::IPubSubClient::createInstance("App")) {}
  void onStart() override {
    subscribeDataPoints(velocitas::QueryBuilder::select(Vehicle.Speed).build())
      ->onItem([this](auto&& r){ float s = r.get(Vehicle.Speed)->value(); })
      ->onError([](auto&& st){ velocitas::logger().error("{}", st.errorMessage()); });
    subscribeToTopic("topic")->onItem([](auto&& data){});
    publishToTopic("topic", "{}");
    Vehicle.Body.Lights.Hazard.IsSignaling.set(true)->onResult(...);          // async
    Vehicle.setMany().add(dpA, 1).add(dpB, 2).apply()->await();              // batch
  }
  vehicle::Vehicle Vehicle;   // generated model
};
```
Kiểm `build/bin/app` thực tồn tại: build.sh có thể exit 0 khi CMake fail (M0 report). Chạy các lệnh build/run trong service Compose phù hợp.

Callback chạy trên thread SDK ⇒ trong SimVehicleApp **chỉ post vào strand của runtime**, không `->await()` trên strand.

## Python SDK 0.15.7
`async on_start()`, `await self.Vehicle.Speed.subscribe(cb)`, `(await dp.get()).value`, `await dp.set(v)`, `@subscribe_topic(t)`, `await self.publish_event(t, json)`; chỉ `sdv.databroker.v1`.

## AppManifest v3
`interfaces[]`: `vehicle-signal-interface {src, datapoints:{required:[{path, required:"true", access:read|write}], provided:[]}}`, `pubsub {reads[], writes[]}`, `grpc-interface {src, required.methods[]}`. SimVehicleApp merge idempotent, không xoá entry không managed (ADR-0023).

## Đừng
Sửa `.velocitas.json` sau init; sửa file "maintained by velocitas CLI"; dùng `runtime-local` (cần docker-in-docker) trong SimVehicleApp; dùng path VSS không có trong release của project.

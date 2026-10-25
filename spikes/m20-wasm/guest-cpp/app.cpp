// M20-T01 spike guest (C++, wasi-sdk reactor, -fno-exceptions): the minimal sv-wasm-abi — imports sv.now_ms and
// sv.log, exports sv_init / sv_step. Uses std::string, std::vector, std::function and std::map to pull in libc++.
#include <cstdint>
#include <functional>
#include <map>
#include <string>
#include <vector>

extern "C" {
__attribute__((import_module("sv"), import_name("now_ms"))) int64_t sv_now_ms();
__attribute__((import_module("sv"), import_name("log"))) void sv_log(const char* text, int32_t len);
}

namespace {
struct App {
    std::map<std::string, double> signals;
    std::vector<std::function<void(int64_t)>> handlers;
    int64_t steps = 0;
};
App* app = nullptr;

void log(const std::string& s) { sv_log(s.data(), static_cast<int32_t>(s.size())); }
} // namespace

extern "C" __attribute__((export_name("sv_init"))) int32_t sv_init() {
    app = new App();
    app->signals["Vehicle.Speed"] = 0;
    app->handlers.push_back([](int64_t now) {
        app->signals["Vehicle.Speed"] += 10;
        if (app->signals["Vehicle.Speed"] > 120) {
            log("overspeed at " + std::to_string(now) + " ms: " + std::to_string(app->signals["Vehicle.Speed"]));
        }
    });
    log("C++ guest started at " + std::to_string(sv_now_ms()));
    return 0;
}

extern "C" __attribute__((export_name("sv_step"))) int32_t sv_step(int64_t now) {
    for (auto& h : app->handlers) h(now);
    return static_cast<int32_t>(++app->steps);
}

// M20-T01 spike: does a guest built with -fwasm-exceptions (the runtime's EvalError) link and run on the host?
#include <cstdint>
#include <stdexcept>
#include <string>

extern "C" {
__attribute__((import_module("sv"), import_name("now_ms"))) int64_t sv_now_ms();
__attribute__((import_module("sv"), import_name("log"))) void sv_log(const char* text, int32_t len);
}

namespace {
struct EvalError : std::runtime_error {
    using std::runtime_error::runtime_error;
};
int64_t caught = 0;
void log(const std::string& s) { sv_log(s.data(), static_cast<int32_t>(s.size())); }
double eval(int64_t now) {
    if (now % 300 == 0) throw EvalError("missing value at " + std::to_string(now));
    return static_cast<double>(now) / 10;
}
} // namespace

extern "C" __attribute__((export_name("sv_init"))) int32_t sv_init() {
    log("C++ EH guest started at " + std::to_string(sv_now_ms()));
    return 0;
}

extern "C" __attribute__((export_name("sv_step"))) int32_t sv_step(int64_t now) {
    try {
        eval(now);
    } catch (const EvalError& e) {
        if (++caught <= 2) log(std::string("caught: ") + e.what());
    }
    return static_cast<int32_t>(caught);
}

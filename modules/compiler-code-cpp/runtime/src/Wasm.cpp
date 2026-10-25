// Copyright (c) 2026 SimVehicleApp contributors
// SPDX-License-Identifier: Apache-2.0
//
// The runtime as a WebAssembly guest (ADR-0061, contracts abi/sv-wasm-abi.v1.md). Built only for wasm32-wasip1
// (SV_RT_WASM): the strand runs on a virtual clock that sv_step moves to the host's time, signals and MQTT go through
// the host's imports, trace and logs are handed to the host, which prints them like a native app.

#include "simvehicleapp/rt/Wasm.hpp"

#include "simvehicleapp/rt/Testing.hpp"

#include <cstdint>
#include <cstdlib>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

extern "C" {
#define SV_IMPORT(name) __attribute__((import_module("sv"), import_name(name)))
SV_IMPORT("now_ms") int64_t sv_now_ms();
SV_IMPORT("log") void sv_log(int32_t level, const char* msg, int32_t len);
SV_IMPORT("trace") void sv_trace(const char* json, int32_t len);
SV_IMPORT("vdb_subscribe") int32_t sv_vdb_subscribe(const char* path, int32_t pathLen, const char* type, int32_t typeLen);
SV_IMPORT("vdb_current")
int32_t sv_vdb_current(const char* path, int32_t pathLen, const char* type, int32_t typeLen, char* out, int32_t cap);
SV_IMPORT("vdb_get") int32_t sv_vdb_get(const char* path, int32_t pathLen, const char* type, int32_t typeLen);
SV_IMPORT("vdb_set")
int32_t sv_vdb_set(const char* path, int32_t pathLen, const char* type, int32_t typeLen, const char* value,
                   int32_t valueLen);
SV_IMPORT("mqtt_subscribe") int32_t sv_mqtt_subscribe(const char* filter, int32_t len);
SV_IMPORT("mqtt_publish") int32_t sv_mqtt_publish(const char* topic, int32_t topicLen, const char* payload, int32_t len);
#undef SV_IMPORT
}

namespace simvehicleapp::rt::wasm {
namespace {

int32_t len(const std::string& s) { return static_cast<int32_t>(s.size()); }

std::string importError(int32_t code) {
    switch (code) {
    case -2:
        return "forbidden";
    case -3:
        return "invalid argument";
    case -4:
        return "unavailable";
    default:
        return "error " + std::to_string(code);
    }
}

/** Trace and logs to the host (`sv.trace` without `v`/`ts`/`app`, which the host adds; `sv.log`). */
class HostSink final : public ITraceSink {
public:
    explicit HostSink(TraceLevel level) : m_level(level) {}
    void trace(const TraceRecord& r) override {
        const bool lifecycle = r.ev.rfind("app.", 0) == 0 || r.ev.rfind("vdb.", 0) == 0;
        if (!lifecycle &&
            (m_level == TraceLevel::Off || (m_level == TraceLevel::Trigger && (r.ev == "enter" || r.ev == "exit")))) {
            return;
        }
        Value line = Value::object();
        if (!r.wf.empty()) line["wf"] = r.wf;
        if (r.run) line["run"] = *r.run;
        if (!r.node.empty()) line["node"] = r.node;
        line["ev"] = r.ev;
        if (r.data) line["data"] = *r.data;
        const std::string text = stringify(line);
        sv_trace(text.data(), len(text));
    }
    void log(int64_t, const std::string& level, const std::string& message) override {
        const std::string text = "[" + level + "] " + message;
        sv_log(level == "error" ? 3 : level == "warn" ? 2 : level == "debug" ? 0 : 1, text.data(), len(text));
    }

private:
    TraceLevel m_level;
};

/** Signals through the host: subscriptions made at init, answers as events posted to the strand. */
class HostVehicle final : public IVehicleAccess {
public:
    explicit HostVehicle(Strand& strand) : m_strand(strand) {}

    void prefetch(const std::string& path, const std::string& type) {
        if (m_subs.count(path) == 0) m_subs[path] = Sub{type, sv_vdb_subscribe(path.data(), len(path), type.data(), len(type)), {}};
    }

    std::optional<Value> current(const std::string& path, const std::string& type) override {
        std::string buf(256, '\0');
        int32_t n = sv_vdb_current(path.data(), len(path), type.data(), len(type), buf.data(), len(buf));
        if (n > len(buf)) {
            buf.assign(static_cast<size_t>(n), '\0');
            n = sv_vdb_current(path.data(), len(path), type.data(), len(type), buf.data(), len(buf));
        }
        if (n < 0) return std::nullopt;
        buf.resize(static_cast<size_t>(n));
        const Value v = Value::parse(buf, nullptr, false);
        if (v.is_discarded() || v.is_null()) return std::nullopt;
        return fromJson(v, type);
    }

    void subscribe(const std::string& path, const std::string& type, std::function<void(const Value&)> onValue) override {
        prefetch(path, type);
        m_subs[path].onValue = std::move(onValue);
    }

    void get(const std::string& path, const std::string& type,
             std::function<void(std::optional<Value>, const std::string&)> done) override {
        const int32_t req = sv_vdb_get(path.data(), len(path), type.data(), len(type));
        if (req < 0) {
            m_strand.post([done, req] { done(std::nullopt, importError(req)); });
            return;
        }
        m_gets[req] = Get{type, std::move(done)};
    }

    void set(const std::string& path, const std::string& type, const Value& value,
             std::function<void(const std::string&)> done) override {
        const std::string json = stringify(toJson(value, type));
        const int32_t req = sv_vdb_set(path.data(), len(path), type.data(), len(type), json.data(), len(json));
        if (req < 0) {
            if (done) m_strand.post([done, req] { done(importError(req)); });
            return;
        }
        if (done) m_sets[req] = std::move(done);
    }

    /** A `signal`, `get_result` or `set_result` event. `started`: the first value of a signal is its baseline. */
    void onEvent(const Value& e, bool started) {
        const std::string kind = e.value("kind", "");
        if (kind == "signal") {
            const auto it = m_subs.find(e.value("path", ""));
            if (it == m_subs.end() || !started || e.value("initial", false) || !it->second.onValue || e["value"].is_null()) return;
            const Value v = fromJson(e["value"], it->second.type);
            auto cb = it->second.onValue;
            m_strand.post([cb, v] { cb(v); });
        } else if (kind == "get_result") {
            const auto it = m_gets.find(e.value("req", 0));
            if (it == m_gets.end()) return;
            Get g = std::move(it->second);
            m_gets.erase(it);
            const std::string error = e.value("error", "");
            std::optional<Value> v;
            if (error.empty() && !e["value"].is_null()) v = fromJson(e["value"], g.type);
            m_strand.post([g, v, error] { g.done(v, error); });
        } else if (kind == "set_result") {
            const auto it = m_sets.find(e.value("req", 0));
            if (it == m_sets.end()) return;
            auto done = std::move(it->second);
            m_sets.erase(it);
            const std::string error = e.value("error", "");
            m_strand.post([done, error] { done(error); });
        }
    }

private:
    struct Sub {
        std::string type;
        int32_t id;
        std::function<void(const Value&)> onValue;
    };
    struct Get {
        std::string type;
        std::function<void(std::optional<Value>, const std::string&)> done;
    };
    Strand& m_strand;
    std::map<std::string, Sub> m_subs;
    std::map<int32_t, Get> m_gets;
    std::map<int32_t, std::function<void(const std::string&)>> m_sets;
};

class HostPubSub final : public IPubSub {
public:
    explicit HostPubSub(Strand& strand) : m_strand(strand) {}
    void setHandler(Handler handler) override { m_handler = std::move(handler); }
    void subscribe(const std::string& filter) override { sv_mqtt_subscribe(filter.data(), len(filter)); }
    void publish(const std::string& topic, const std::string& payload) override {
        sv_mqtt_publish(topic.data(), len(topic), payload.data(), len(payload));
    }
    void onEvent(const Value& e) {
        if (!m_handler) return;
        auto h = m_handler;
        const std::string topic = e.value("topic", ""), payload = e.value("payload", "");
        m_strand.post([h, topic, payload] { h(topic, payload, nullptr); });
    }

private:
    Strand& m_strand;
    Handler m_handler;
};

struct Guest {
    App app;
    std::unique_ptr<Strand> strand;
    std::unique_ptr<HostSink> sink;
    std::unique_ptr<HostVehicle> vehicle;
    std::unique_ptr<HostPubSub> pubsub;
    std::unique_ptr<Runtime> runtime;
    bool started = false;
};

std::optional<App>& registered() {
    static std::optional<App> app;
    return app;
}

Guest& guest() {
    static Guest g;
    return g;
}

TraceLevel levelOf(const std::string& s, TraceLevel fallback) {
    if (s == "off") return TraceLevel::Off;
    if (s == "trigger") return TraceLevel::Trigger;
    if (s == "node") return TraceLevel::Node;
    return fallback;
}

/** Runs what is due up to the host's time before an event is handled, so it lands at the right instant. */
void catchUp() {
    Guest& g = guest();
    if (g.strand) g.strand->runUntil(std::max(g.strand->nowMs(), sv_now_ms()));
}

} // namespace

bool registerApp(App app) {
    registered() = std::move(app);
    return true;
}

} // namespace simvehicleapp::rt::wasm

using namespace simvehicleapp::rt;
using namespace simvehicleapp::rt::wasm;

extern "C" {

__attribute__((export_name("sv_alloc"))) int32_t sv_alloc(int32_t n) {
    return static_cast<int32_t>(reinterpret_cast<uintptr_t>(std::malloc(static_cast<size_t>(n > 0 ? n : 1))));
}

__attribute__((export_name("sv_free"))) void sv_free(int32_t ptr, int32_t) {
    std::free(reinterpret_cast<void*>(static_cast<uintptr_t>(ptr)));
}

/** Config `{app, traceLevel}`: binds the workflows and subscribes their signals; the runtime starts on `start`. */
__attribute__((export_name("sv_init"))) int32_t sv_init(const char* config, int32_t n) {
    auto& app = registered();
    if (!app) return 1;
    const Value cfg = Value::parse(std::string(config, static_cast<size_t>(n)), nullptr, false);
    Guest& g = guest();
    g.app = *app;
    const TraceLevel level = levelOf(cfg.is_object() ? cfg.value("traceLevel", "") : "", g.app.level);
    g.strand = std::make_unique<Strand>();
    g.strand->runUntil(sv_now_ms());
    g.sink = std::make_unique<HostSink>(level);
    g.vehicle = std::make_unique<HostVehicle>(*g.strand);
    g.pubsub = std::make_unique<HostPubSub>(*g.strand);
    g.runtime = std::make_unique<Runtime>(*g.strand, *g.vehicle, *g.pubsub, *g.sink);
    for (const auto& [id, bind] : g.app.workflows) bind(*g.runtime);
    for (const auto& [path, type] : g.runtime->signals()) g.vehicle->prefetch(path, type);
    return 0;
}

__attribute__((export_name("sv_on_event"))) void sv_on_event(const char* event, int32_t n) {
    Guest& g = guest();
    if (!g.runtime) return;
    const Value e = Value::parse(std::string(event, static_cast<size_t>(n)), nullptr, false);
    if (!e.is_object()) return;
    catchUp();
    const std::string kind = e.value("kind", "");
    if (kind == "start") {
        if (g.started) return;
        g.started = true;
        g.app.onAppStart();
        g.runtime->start();
    } else if (kind == "mqtt") {
        g.pubsub->onEvent(e);
    } else if (kind == "stop") {
        g.runtime->stopAll();
    } else {
        g.vehicle->onEvent(e, g.started);
    }
}

/** Runs everything due up to `now`; the next due time, -1 when nothing is scheduled. */
__attribute__((export_name("sv_step"))) int64_t sv_step(int64_t now) {
    Guest& g = guest();
    if (!g.strand) return -1;
    g.strand->runUntil(std::max(g.strand->nowMs(), now));
    return g.strand->nextDueMs();
}

__attribute__((export_name("sv_stop"))) void sv_stop() {
    Guest& g = guest();
    if (!g.runtime) return;
    TraceRecord r{0, epochMs(), "app.stopping", "", std::nullopt, "", "", std::nullopt};
    g.sink->trace(r);
    g.app.onAppStop();
    g.runtime->stopAll();
}

/**
 * Test cases `[{name, workflow, scenario}]` on a mock vehicle and a virtual clock inside the guest (the generated
 * tests of a WASM app, ADR-0058): each case runs its workflow only, like the native generated tests; one log line per
 * case, the number of failed cases returned.
 */
__attribute__((export_name("sv_run_tests"))) int32_t sv_run_tests(const char* cases, int32_t n) {
    auto& app = registered();
    if (!app) return 1;
    const Value list = Value::parse(std::string(cases, static_cast<size_t>(n)), nullptr, false);
    if (!list.is_array()) return 1;
    int32_t failed = 0;
    for (const auto& c : list) {
        const std::string name = c.value("name", "case");
        const std::string workflow = c.value("workflow", "");
        std::function<void(Runtime&)> bind;
        for (const auto& wf : app->workflows) {
            if (!workflow.empty() && wf.first != workflow) continue;
            const auto b = wf.second;
            bind = bind ? [prev = bind, b](Runtime& r) { prev(r), b(r); } : b;
        }
        if (!bind) {
            const std::string text = "FAIL " + name + "\n  no workflow " + workflow + " in this app";
            sv_log(3, text.data(), static_cast<int32_t>(text.size()));
            ++failed;
            continue;
        }
        const auto result = testing::runScenario(bind, c["scenario"], "test");
        const auto mismatches = testing::checkExpectations(result, c["scenario"].value("expect", Value::object()));
        std::string text = (mismatches.empty() ? "PASS " : "FAIL ") + name;
        for (const auto& m : mismatches) text += "\n  " + m;
        sv_log(mismatches.empty() ? 1 : 3, text.data(), static_cast<int32_t>(text.size()));
        failed += mismatches.empty() ? 0 : 1;
    }
    return failed;
}
}

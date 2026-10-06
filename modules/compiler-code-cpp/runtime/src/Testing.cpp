// Copyright (c) 2026 SimVehicleApp contributors
// SPDX-License-Identifier: Apache-2.0

#include "simvehicleapp/rt/Testing.hpp"

namespace simvehicleapp::rt::testing {

namespace {
Value timedJson(const Timed& x, const char* key, const char* value) {
    Value o = Value::object();
    o["t"] = x.t;
    o[key] = x.key;
    o[value] = x.value;
    return o;
}

/** `String(x)` of a JSON value (allowed values are compared as text, like the simulator). */
std::string jsString(const Value& v) {
    if (v.is_string()) {
        return v.get<std::string>();
    }
    return formatValue(v, "");
}
} // namespace

// ---- MockVehicle ----------------------------------------------------------------------------------

MockVehicle::MockVehicle(Strand& strand)
    : m_strand(strand) {}

void MockVehicle::setInitial(const std::string& path, const Value& value) { m_raw[path] = value; }

void MockVehicle::setLatency(int64_t readMs, int64_t writeMs) {
    m_readMs = readMs;
    m_writeMs = writeMs;
}

void MockVehicle::setBounds(const std::string& path, Bounds bounds) { m_bounds[path] = std::move(bounds); }

void MockVehicle::inject(const std::string& path, const Value& raw) {
    auto type = m_types.find(path);
    if (type == m_types.end()) {
        return; // a signal the app does not use
    }
    const Value v = fromJson(raw, type->second);
    m_values[path] = v;
    m_signals.push_back(Timed{m_strand.nowMs(), path, toJson(v, type->second)});
    const auto subs = m_subs[path];
    for (const auto& cb : subs) {
        cb(v);
    }
}

std::optional<Value> MockVehicle::current(const std::string& path, const std::string& type) {
    m_types[path] = type;
    auto it = m_raw.find(path);
    if (it == m_raw.end()) {
        return std::nullopt;
    }
    m_values[path] = fromJson(it->second, type);
    return m_values[path];
}

void MockVehicle::subscribe(const std::string& path, const std::string& type,
                            std::function<void(const Value&)> onValue) {
    m_types[path] = type;
    m_subs[path].push_back(std::move(onValue));
}

void MockVehicle::get(const std::string& path, const std::string& type,
                      std::function<void(std::optional<Value>, const std::string&)> done) {
    (void)type;
    m_strand.postAt(m_strand.nowMs() + m_readMs, [this, path, done] {
        auto it = m_values.find(path);
        done(it != m_values.end() ? std::optional<Value>(it->second) : std::nullopt, "");
    });
}

std::string MockVehicle::checkWrite(const std::string& path, const std::string& type, const Value& value) {
    auto it = m_bounds.find(path);
    if (it == m_bounds.end()) {
        return {};
    }
    const Bounds& b = it->second;
    const bool numeric = value.is_number();
    const double n = toNumber(value);
    bool bad = (b.min && numeric && n < *b.min) || (b.max && numeric && n > *b.max);
    if (!bad && b.allowed) {
        bool found = false;
        for (const auto& x : *b.allowed) {
            if (jsString(x) == jsString(value)) {
                found = true;
            }
        }
        bad = !found;
    }
    if (!bad) {
        return {};
    }
    return jsString(toJson(value, type)) + " is outside the allowed values of " + path;
}

void MockVehicle::set(const std::string& path, const std::string& type, const Value& value,
                      std::function<void(const std::string&)> done) {
    // An actuator write sets its target; the current value changes only when the vehicle reports it.
    m_writes.push_back(Timed{m_strand.nowMs(), path, toJson(value, type)});
    if (done) {
        m_strand.postAt(m_strand.nowMs() + m_writeMs, [done] { done(""); });
    }
}

// ---- MockPubSub ------------------------------------------------------------------------------------

MockPubSub::MockPubSub(Strand& strand)
    : m_strand(strand) {}

void MockPubSub::inject(const std::string& topic, const std::string& payload) {
    if (m_handler) {
        m_handler(topic, payload, nullptr);
    }
}

void MockPubSub::setHandler(Handler handler) { m_handler = std::move(handler); }

void MockPubSub::subscribe(const std::string& filter) { (void)filter; }

void MockPubSub::publish(const std::string& topic, const std::string& payload) {
    m_publishes.push_back(Timed{m_strand.nowMs(), topic, Value(payload)});
    inject(topic, payload);
}

// ---- scenarios ----------------------------------------------------------------------------------------

ScenarioResult runScenario(const std::function<void(Runtime&)>& bind, const Value& scenario, const std::string& runId,
                           const std::map<std::string, Bounds>& bounds) {
    Strand strand;
    MockVehicle vehicle(strand);
    MockPubSub pubsub(strand);
    RecordingSink sink;
    Runtime rt(strand, vehicle, pubsub, sink);
    bind(rt);

    if (scenario.contains("initial")) {
        for (auto it = scenario["initial"].begin(); it != scenario["initial"].end(); ++it) {
            vehicle.setInitial(it.key(), it.value());
        }
    }
    if (scenario.contains("latency")) {
        const auto& l = scenario["latency"];
        vehicle.setLatency(l.value("read", 0), l.value("write", 0));
    }
    for (const auto& [path, b] : bounds) {
        vehicle.setBounds(path, b);
    }
    // Inputs first (lowest sequence at each instant), then the app start — simulator order.
    for (const auto& input : scenario.value("inputs", Value::array())) {
        const int64_t t = input["t"].get<int64_t>();
        if (input.contains("topic")) {
            const std::string topic = input["topic"].get<std::string>();
            const std::string payload =
                input["value"].is_string() ? input["value"].get<std::string>() : stringify(input["value"]);
            strand.postAt(t, [&pubsub, topic, payload] { pubsub.inject(topic, payload); });
        } else {
            const std::string path = input["path"].get<std::string>();
            const Value value = input["value"];
            strand.postAt(t, [&vehicle, path, value] { vehicle.inject(path, value); });
        }
    }
    rt.start();
    strand.runUntil(scenario["until"].get<int64_t>());

    ScenarioResult r;
    for (const auto& rec : sink.records) {
        Value e = Value::object();
        e["runId"] = runId;
        e["seq"] = rec.seq;
        e["ts"] = rec.ts;
        e["ev"] = rec.ev;
        if (!rec.wf.empty()) {
            e["wf"] = rec.wf;
        }
        if (rec.run) {
            e["run"] = *rec.run;
        }
        if (!rec.node.empty()) {
            e["node"] = rec.node;
        }
        if (!rec.blockId.empty()) {
            e["blockId"] = rec.blockId;
        }
        if (rec.data) {
            e["data"] = *rec.data;
        }
        r.trace.push_back(e);
    }
    for (const auto& w : vehicle.writes()) {
        r.writes.push_back(timedJson(w, "path", "value"));
    }
    for (const auto& s : vehicle.signals()) {
        r.signals.push_back(timedJson(s, "path", "value"));
    }
    for (const auto& p : pubsub.publishes()) {
        r.publishes.push_back(timedJson(p, "topic", "payload"));
    }
    for (const auto& l : sink.logs) {
        r.logs.push_back(timedJson(l, "level", "message"));
    }
    return r;
}

namespace {
bool same(const Value& a, const Value& b) { return stringify(a) == stringify(b); }

bool subset(const Value& want, const Value* have) {
    if (want.is_object()) {
        if (have == nullptr || !have->is_object()) {
            return false;
        }
        for (auto it = want.begin(); it != want.end(); ++it) {
            const auto h = have->find(it.key());
            if (!subset(it.value(), h != have->end() ? &*h : nullptr)) {
                return false;
            }
        }
        return true;
    }
    return have != nullptr && same(want, *have);
}
} // namespace

std::vector<std::string> checkExpectations(const ScenarioResult& result, const Value& expect) {
    std::vector<std::string> out;
    if (expect.is_null()) {
        return out;
    }
    if (expect.contains("writes")) {
        Value have = Value::array();
        for (const auto& w : result.writes) {
            Value o = Value::object();
            o["t"] = w["t"];
            o["path"] = w["path"];
            o["value"] = w["value"];
            have.push_back(o);
        }
        if (!same(have, expect["writes"])) {
            out.push_back("writes differ:\n  expected " + stringify(expect["writes"]) + "\n  actual   " +
                          stringify(have));
        }
    }
    if (expect.contains("trace")) {
        size_t i = 0;
        for (const auto& m : expect["trace"]) {
            while (i < result.trace.size() && !subset(m, &result.trace[i])) {
                ++i;
            }
            if (i == result.trace.size()) {
                out.push_back("trace event " + stringify(m) + " not found (in order)");
                break;
            }
            ++i;
        }
    }
    return out;
}

} // namespace simvehicleapp::rt::testing

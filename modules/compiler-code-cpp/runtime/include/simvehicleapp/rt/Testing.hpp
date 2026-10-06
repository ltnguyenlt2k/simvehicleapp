// Copyright (c) 2026 SimVehicleApp contributors
// SPDX-License-Identifier: Apache-2.0

#ifndef SIMVEHICLEAPP_RT_TESTING_HPP
#define SIMVEHICLEAPP_RT_TESTING_HPP

#include "simvehicleapp/rt/Runtime.hpp"

#include <functional>
#include <map>
#include <optional>
#include <string>
#include <vector>

/**
 * Test doubles of the runtime (ADR-0021 §9, ADR-0042 P1): a vehicle and an MQTT broker on a
 * virtual clock, and a scenario player — the same model as the simulator, so a workflow run on
 * them must produce the golden trace exactly.
 */
namespace simvehicleapp::rt::testing {

struct Timed {
    int64_t t;
    std::string key; // path or topic
    Value value;     // JSON value (writes, signals) or payload string (publishes)
};

/** Bounds of a written signal (catalog min/max/allowed), checked like the simulator's `model`. */
struct Bounds {
    std::optional<double> min;
    std::optional<double> max;
    std::optional<std::vector<Value>> allowed;
};

/** Vehicle on the virtual clock: writes set the target only (ADR-0017 Notes §3). */
class MockVehicle final : public IVehicleAccess {
public:
    explicit MockVehicle(Strand& strand);

    void setInitial(const std::string& path, const Value& value);
    void setLatency(int64_t readMs, int64_t writeMs);
    void setBounds(const std::string& path, Bounds bounds);
    /** The vehicle reports a new value (scenario input). */
    void inject(const std::string& path, const Value& value);

    const std::vector<Timed>& writes() const { return m_writes; }
    const std::vector<Timed>& signals() const { return m_signals; }

    std::optional<Value> current(const std::string& path, const std::string& type) override;
    void subscribe(const std::string& path, const std::string& type, std::function<void(const Value&)> onValue) override;
    void get(const std::string& path, const std::string& type,
             std::function<void(std::optional<Value>, const std::string&)> done) override;
    std::string checkWrite(const std::string& path, const std::string& type, const Value& value) override;
    void set(const std::string& path, const std::string& type, const Value& value,
             std::function<void(const std::string&)> done) override;

private:
    Strand& m_strand;
    int64_t m_readMs = 0;
    int64_t m_writeMs = 0;
    std::map<std::string, Value> m_raw;    // initial values as given
    std::map<std::string, Value> m_values; // typed values
    std::map<std::string, std::string> m_types;
    std::map<std::string, std::vector<std::function<void(const Value&)>>> m_subs;
    std::map<std::string, Bounds> m_bounds;
    std::vector<Timed> m_writes;
    std::vector<Timed> m_signals;
};

/** Broker on the virtual clock: publishes are delivered back to the app at once (loopback). */
class MockPubSub final : public IPubSub {
public:
    explicit MockPubSub(Strand& strand);
    void inject(const std::string& topic, const std::string& payload);
    const std::vector<Timed>& publishes() const { return m_publishes; }

    void setHandler(Handler handler) override;
    void subscribe(const std::string& filter) override;
    void publish(const std::string& topic, const std::string& payload) override;

private:
    Strand& m_strand;
    Handler m_handler;
    std::vector<Timed> m_publishes;
};

/** Keeps every trace event and log line. */
class RecordingSink final : public ITraceSink {
public:
    void trace(const TraceRecord& record) override { records.push_back(record); }
    void log(int64_t ts, const std::string& level, const std::string& message) override {
        logs.push_back(Timed{ts, level, Value(message)});
    }
    std::vector<TraceRecord> records;
    std::vector<Timed> logs;
};

/** Outcome of a scenario run, in the simulator's JSON shapes. */
struct ScenarioResult {
    Value trace = Value::array();     // TraceEvent v1
    Value writes = Value::array();    // {t, path, value}
    Value signals = Value::array();   // {t, path, value}
    Value publishes = Value::array(); // {t, topic, payload}
    Value logs = Value::array();      // {t, level, message}
};

/**
 * Runs a scenario (contracts `scenario` v1 as JSON) against the workflows `bind` declares:
 * inputs are scheduled before the app starts (simulator order), the clock runs to `until`.
 */
ScenarioResult runScenario(const std::function<void(Runtime&)>& bind, const Value& scenario,
                           const std::string& runId = "sim",
                           const std::map<std::string, Bounds>& bounds = {});

/** `expect` of a scenario: exact writes, ordered partial trace matchers; returns the mismatches. */
std::vector<std::string> checkExpectations(const ScenarioResult& result, const Value& expect);

} // namespace simvehicleapp::rt::testing

#endif // SIMVEHICLEAPP_RT_TESTING_HPP

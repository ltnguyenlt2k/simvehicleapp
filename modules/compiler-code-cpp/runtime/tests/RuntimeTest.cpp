// Copyright (c) 2026 SimVehicleApp contributors
// SPDX-License-Identifier: Apache-2.0

#include "simvehicleapp/rt/Testing.hpp"

#include <gtest/gtest.h>

#include <fstream>
#include <sstream>

using namespace simvehicleapp;
using namespace simvehicleapp::rt;
using rt::testing::runScenario;

namespace {

Value readJson(const std::string& rel) {
    std::ifstream in(std::string(SV_FIXTURES_DIR) + rel);
    std::stringstream ss;
    ss << in.rdbuf();
    return Value::parse(ss.str());
}

const Outputs kChange{{"value", "float"}, {"previous", "float"}, {"timestamp", "timestamp"}};

/** Golden GW-A (fixtures/golden/GW-A/ir.json) declared by hand, one statement per IR element. */
void bindGwA(Runtime& r) {
    auto& w = r.workflow("gw_a", "StableOverspeedWarning");
    const auto hazard = w.signal("s0", "Vehicle.Body.Lights.Hazard.IsSignaling", "boolean");
    const auto speed = w.signal("s1", "Vehicle.Speed", "float");
    const auto hmi = w.topic("t0", "simvehicleapp/stable-overspeed-warning/hmi");
    w.onSignalChanged({"n1", "b1"}, speed, Change::Any, std::nullopt, 0, {Policy::Restart}, kChange, "n2");
    w.onSignalChanged({"n5", "b5"}, speed, Change::CrossesBelow, fromJson(Value(110), "float"), 0, {Policy::Restart},
                      kChange, "n6");
    w.stableFor({"n2", "b2"}, [](Ctx& c) { return gt(c.out<float>("n1", "value"), int64_t{120}); }, 2000,
                {{"broken", ""}, {"stable", "n3"}});
    w.write({"n3", "b3"}, hazard, expr([](Ctx&) { return true; }), true, OnError::Continue,
            {{"error", ""}, {"next", "n4"}});
    w.publish({"n4", "b4"}, hmi, expr([](Ctx& c) {
                  return std::string("{\"severity\":\"warning\",\"title\":") + jsonString("Overspeed") +
                         ",\"message\":" +
                         jsonString(std::string("Speed ") + format(c.out<float>("n1", "value")) + " km/h") +
                         ",\"ts\":" + format(c.nowMs()) + "}";
              }),
              {{"error", ""}, {"next", ""}});
    w.write({"n6", "b6"}, hazard, expr([](Ctx&) { return false; }), true, OnError::Continue,
            {{"error", ""}, {"next", ""}});
}

Value scenarioOf(const std::string& yamlLikeJson) { return Value::parse(yamlLikeJson); }

/** fixtures/golden/GW-A/scenario.yaml as JSON (the generated tests embed scenarios the same way). */
const char* kGwAScenario = R"({
  "scenarioVersion": "1.0.0", "name": "GW-A", "until": 8000,
  "initial": {"Vehicle.Speed": 0, "Vehicle.Body.Lights.Hazard.IsSignaling": false},
  "inputs": [
    {"t": 1000, "path": "Vehicle.Speed", "value": 100},
    {"t": 2000, "path": "Vehicle.Speed", "value": 130},
    {"t": 3000, "path": "Vehicle.Speed", "value": 135},
    {"t": 6000, "path": "Vehicle.Speed", "value": 105}
  ]
})";

} // namespace

TEST(RuntimeTest, goldenGwAMatchesTheFrozenTraceEventForEvent) {
    const Value sc = scenarioOf(kGwAScenario);
    const auto r = runScenario(bindGwA, sc, "golden");
    const Value wantTrace = readJson("golden/GW-A/expected.trace.json");
    const Value wantWrites = readJson("golden/GW-A/expected.writes.json");
    ASSERT_EQ(stringify(r.writes), stringify(wantWrites));
    ASSERT_EQ(r.trace.size(), wantTrace.size());
    for (size_t i = 0; i < wantTrace.size(); ++i) {
        ASSERT_EQ(stringify(r.trace[i]), stringify(wantTrace[i])) << "event " << i;
    }
}

TEST(RuntimeTest, gateExampleRestartMovesTheWrite) {
    // M5 gate example: Speed 100 → 130 at 1000, change at 2500 ⇒ restart ⇒ write at 4500.
    const Value sc = scenarioOf(R"({"until": 6000, "initial": {"Vehicle.Speed": 100, "Vehicle.Body.Lights.Hazard.IsSignaling": false},
      "inputs": [{"t": 1000, "path": "Vehicle.Speed", "value": 130}, {"t": 2500, "path": "Vehicle.Speed", "value": 140}]})");
    const auto r = runScenario(bindGwA, sc);
    EXPECT_EQ(stringify(r.writes), R"([{"t":4500,"path":"Vehicle.Body.Lights.Hazard.IsSignaling","value":true}])");
    int cancels = 0;
    for (const auto& e : r.trace) {
        if (e["ev"] == "cancel") {
            ++cancels;
            EXPECT_EQ(e["ts"], 2500);
            EXPECT_EQ(e["data"]["reason"], "restart");
        }
    }
    EXPECT_EQ(cancels, 1);
    EXPECT_EQ(stringify(r.publishes[0]["payload"]),
              R"("{\"severity\":\"warning\",\"title\":\"Overspeed\",\"message\":\"Speed 140 km/h\",\"ts\":4500}")");
}

TEST(RuntimeTest, queueOverflowDropsTheOldestAndParallelJoinAnyCancelsTheRest) {
    auto bind = [](Runtime& r) {
        auto& w = r.workflow("w", "W");
        const auto rain = w.signal("s0", "Vehicle.Body.Raindetection.Intensity", "uint8");
        const auto fan = w.signal("s1", "Vehicle.Cabin.HVAC.Station.Row1.Driver.FanSpeed", "uint8");
        w.onSignalChanged({"n1", "b1"}, rain, Change::Any, std::nullopt, 0, {Policy::Queue, 1, 4},
                          {{"value", "uint8"}, {"previous", "uint8"}, {"timestamp", "timestamp"}}, "n2");
        w.parallel({"n2", "b2"}, {"n3", "n4"}, Join::Any, {{"next", "n5"}});
        w.wait({"n3", "b3"}, 100, {{"next", ""}});
        w.wait({"n4", "b4"}, 300, {{"next", "n6"}});
        w.write({"n6", "b6"}, fan, expr([](Ctx&) { return uint8_t{1}; }), true, OnError::Continue, {{"next", ""}});
        w.write({"n5", "b5"}, fan, expr([](Ctx& c) { return c.out<uint8_t>("n1", "value"); }), true,
                OnError::Continue, {{"next", ""}});
    };
    const Value sc = scenarioOf(R"({"until": 2000, "initial": {"Vehicle.Body.Raindetection.Intensity": 0},
      "inputs": [{"t": 10, "path": "Vehicle.Body.Raindetection.Intensity", "value": 1},
                 {"t": 20, "path": "Vehicle.Body.Raindetection.Intensity", "value": 2},
                 {"t": 30, "path": "Vehicle.Body.Raindetection.Intensity", "value": 3}]})");
    const auto r = runScenario(bind, sc);
    // run 1 ends at 110: n3 wins, n4 is cancelled at once (never writes 1); the queue kept only value 3.
    EXPECT_EQ(stringify(r.writes),
              R"([{"t":110,"path":"Vehicle.Cabin.HVAC.Station.Row1.Driver.FanSpeed","value":1},)"
              R"({"t":210,"path":"Vehicle.Cabin.HVAC.Station.Row1.Driver.FanSpeed","value":3}])");
    int overflow = 0;
    for (const auto& e : r.trace) {
        if (e["ev"] == "error" && e["data"]["reason"] == "queue_overflow") {
            ++overflow;
            EXPECT_EQ(e["run"], 0);
        }
    }
    EXPECT_EQ(overflow, 1);
}

TEST(RuntimeTest, whileGuardStopsTheRunAndNoValueTakesTheErrorPath) {
    auto bind = [](Runtime& r) {
        auto& w = r.workflow("w", "W");
        const auto fan = w.signal("s1", "Vehicle.Cabin.HVAC.Station.Row1.Driver.FanSpeed", "uint8");
        const auto speed = w.signal("s0", "Vehicle.Speed", "float");
        w.onAppStart({"n1", "b1"}, {}, {}, "n2");
        w.whileLoop({"n2", "b2"}, [](Ctx&) { return true; }, 3, 0, "n3", {{"next", "n4"}});
        w.wait({"n3", "b3"}, 10, {{"next", ""}});
        w.write({"n4", "b4"}, fan, expr([](Ctx&) { return uint8_t{9}; }), true, OnError::Continue, {{"next", ""}});
        w.onAppStart({"n5", "b5"}, {}, {}, "n6");
        w.write({"n6", "b6"}, fan, expr([speed](Ctx& c) { return as<uint8_t>(c.signal<float>(speed)); }), true,
                OnError::Continue, {{"error", ""}, {"next", ""}});
    };
    const auto r = runScenario(bind, scenarioOf(R"({"until": 1000, "inputs": []})"));
    EXPECT_EQ(stringify(r.writes), "[]");
    std::vector<std::string> errors;
    for (const auto& e : r.trace) {
        if (e["ev"] == "error") {
            errors.push_back(stringify(e["data"]));
        }
    }
    EXPECT_EQ(errors, (std::vector<std::string>{R"({"reason":"no_value","message":"signal s0 has no value yet"})",
                                                R"({"reason":"loop_guard","maxIterations":3})"}));
}

TEST(RuntimeTest, expectationsAreCheckedLikeTheSimulator) {
    const auto r = runScenario(bindGwA, scenarioOf(kGwAScenario));
    const Value ok = Value::parse(R"({"writes": [{"t": 5000, "path": "Vehicle.Body.Lights.Hazard.IsSignaling", "value": true},
      {"t": 6000, "path": "Vehicle.Body.Lights.Hazard.IsSignaling", "value": false}],
      "trace": [{"ev": "cancel", "data": {"reason": "restart"}}, {"ev": "write", "node": "n3"}]})");
    EXPECT_TRUE(rt::testing::checkExpectations(r, ok).empty());
    const Value bad = Value::parse(R"({"writes": [], "trace": [{"ev": "write", "node": "n9"}]})");
    EXPECT_EQ(rt::testing::checkExpectations(r, bad).size(), 2u);
}

TEST(RuntimeTest, fibersStillWaitingWhenTheRuntimeIsDestroyedAreReleasedSafely) {
    // Conformance C16 shape: a timer whose runs wait longer than its interval (ignore policy); the
    // scenario ends while a run waits, so strand events outlive the runtime.
    auto bind = [](Runtime& r) {
        auto& w = r.workflow("w", "W");
        const auto fan = w.signal("s0", "Vehicle.Cabin.HVAC.Station.Row1.Driver.FanSpeed", "uint8");
        w.onTimer({"n1", "b1"}, 1000, 1000, {Policy::Ignore}, {{"tick", "uint32"}, {"timestamp", "timestamp"}}, "n2");
        w.wait({"n2", "b2"}, 1500, {{"next", "n3"}});
        w.write({"n3", "b3"}, fan, expr([](Ctx& c) { return as<uint8_t>(c.out<int64_t>("n1", "tick")); }), true,
                OnError::Continue, {{"next", ""}});
    };
    const auto r = runScenario(bind, scenarioOf(R"({"until": 5600, "inputs": []})"));
    EXPECT_EQ(stringify(r.writes), R"([{"t":2500,"path":"Vehicle.Cabin.HVAC.Station.Row1.Driver.FanSpeed","value":1},)"
                                   R"({"t":4500,"path":"Vehicle.Cabin.HVAC.Station.Row1.Driver.FanSpeed","value":3}])");
}

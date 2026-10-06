// Copyright (c) 2026 SimVehicleApp contributors
// SPDX-License-Identifier: Apache-2.0

#ifndef SIMVEHICLEAPP_RT_RUNTIME_HPP
#define SIMVEHICLEAPP_RT_RUNTIME_HPP

#include "simvehicleapp/rt/Access.hpp"
#include "simvehicleapp/rt/Strand.hpp"
#include "simvehicleapp/rt/Value.hpp"

#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

/**
 * SimVehicleApp runtime for C++ vehicle apps (ADR-0021, execution semantics ADR-0012 + ADR-0017
 * Notes, executable spec = conformance C01…C38 and the golden traces).
 *
 * Generated code declares each workflow with a `Workflow` builder — one statement per IR trigger
 * and node, expressions as typed lambdas — and the runtime executes it on one strand. All timing,
 * concurrency policies, cancellation and tracing live here once instead of in every generated file.
 */
namespace simvehicleapp::rt {

class Runtime;
class Workflow;
struct RunState;

/** IR identity of a trigger or node: `nK` and the block it came from (trace + source map). */
struct Node {
    const char* id;
    const char* blockId;
};

/** Output handle → next node id; "" ends the run (IR `next`, ADR-0014). */
using Next = std::vector<std::pair<std::string, std::string>>;
/** Output name → type of a trigger (trace `trigger` data). */
using Outputs = std::vector<std::pair<std::string, std::string>>;

struct SignalRef {
    std::string id;
    std::string path;
    std::string type;
};
struct TopicRef {
    std::string id;
    std::string topic;
};
struct StateRef {
    std::string id;
    std::string type;
};

/** Evaluation context of an expression: the current run (if any) and the app state. */
class Ctx {
public:
    Ctx(Runtime& rt, Workflow& wf, RunState* run)
        : m_rt(rt)
        , m_wf(wf)
        , m_run(run) {}

    /** Output `output` of trigger/node `node` in this run; missing ⇒ `no_value` (ADR-0017 Notes §14). */
    template <class T> T out(const char* node, const char* output) const {
        return From<T>::get(outValue(node, output));
    }
    /** Latest value of a signal; none yet ⇒ `no_value`. */
    template <class T> T signal(const SignalRef& s) const { return From<T>::get(signalValue(s)); }
    /** Current value of a workflow variable. */
    template <class T> T state(const StateRef& v) const { return From<T>::get(stateValue(v)); }
    /** `now_ms`: milliseconds of the app clock. */
    int64_t nowMs() const;

    const Value& outValue(const char* node, const char* output) const;
    const Value& signalValue(const SignalRef& s) const;
    const Value& stateValue(const StateRef& v) const;

private:
    Runtime& m_rt;
    Workflow& m_wf;
    RunState* m_run;
};

using Expr = std::function<Value(Ctx&)>;
using Cond = std::function<bool(Ctx&)>;

/** Wraps a typed lambda `T(Ctx&)` as an `Expr`. */
template <class F> Expr expr(F f) {
    return [f](Ctx& c) { return toValue(f(c)); };
}

enum class Change { Any, Rising, Falling, CrossesAbove, CrossesBelow, Becomes };
enum class Policy { Restart, Ignore, Queue, Parallel };
enum class Join { All, Any, None };
enum class StopScope { Run, Workflow, App };
enum class OnError { Continue, Stop };
enum class CounterOp { Inc, Dec, Reset };

/** Concurrency policy of a trigger (ADR-0012 §4; IR `concurrency`, default parallel/4). */
struct Concurrency {
    Policy policy = Policy::Parallel;
    int queueMax = 8;
    int maxRuns = 4;
};

/** One trace event (TraceEvent v1 without `runId`/`seq`, which the sink adds). */
struct TraceRecord {
    uint64_t seq;
    int64_t ts;
    std::string ev;
    std::string wf;
    std::optional<int64_t> run;
    std::string node;
    std::string blockId;
    std::optional<Value> data;
};

enum class TraceLevel { Off, Trigger, Node };

/** Receives trace events and logs (stdout `SVTRACE` lines in a real app, a list in tests). */
class ITraceSink {
public:
    virtual ~ITraceSink() = default;
    virtual void trace(const TraceRecord& record) = 0;
    virtual void log(int64_t ts, const std::string& level, const std::string& message) = 0;
};

/** `SVTRACE {json}` lines on stdout (ADR-0021 §7, contracts trace-event `runtimeLine`). */
class StdoutTraceSink final : public ITraceSink {
public:
    StdoutTraceSink(std::string appName, TraceLevel level);
    /** Level from env `SV_TRACE_LEVEL` (`off`, `trigger`, `node`), else `fallback`. */
    static TraceLevel levelFromEnv(TraceLevel fallback = TraceLevel::Node);
    void trace(const TraceRecord& record) override;
    void log(int64_t ts, const std::string& level, const std::string& message) override;

private:
    std::string m_app;
    TraceLevel m_level;
};

/** Builder of one workflow (one generated class); every call mirrors one IR trigger or node. */
class Workflow {
public:
    Workflow(Runtime& rt, std::string id, std::string name);
    Workflow(const Workflow&) = delete;
    Workflow& operator=(const Workflow&) = delete;

    const std::string& id() const { return m_id; }
    const std::string& name() const { return m_name; }

    SignalRef signal(const std::string& id, const std::string& path, const std::string& type);
    TopicRef topic(const std::string& id, const std::string& topic);
    StateRef state(const std::string& id, const std::string& type, const Value& initial);

    void onAppStart(Node n, Concurrency c, Outputs outputs, const std::string& entry);
    void onSignalChanged(Node n, const SignalRef& s, Change mode, std::optional<Value> threshold,
                         int64_t debounceMs, Concurrency c, Outputs outputs, const std::string& entry);
    void onTimer(Node n, int64_t intervalMs, int64_t initialDelayMs, Concurrency c, Outputs outputs,
                 const std::string& entry);
    void onCondition(Node n, Cond condition, int64_t debounceMs, Concurrency c, Outputs outputs,
                     const std::string& entry);
    void onMqtt(Node n, const TopicRef& t, bool jsonPayload, Concurrency c, Outputs outputs,
                const std::string& entry);

    void read(Node n, const SignalRef& s, bool fresh, Next next);
    void write(Node n, const SignalRef& s, Expr value, bool awaitAck, OnError onError, Next next);
    void branch(Node n, Cond condition, Next next);
    void switchOn(Node n, Expr value, std::vector<Expr> cases, Next next);
    void wait(Node n, int64_t durationMs, Next next);
    void waitUntil(Node n, Cond condition, int64_t timeoutMs, Next next);
    void stableFor(Node n, Cond condition, int64_t durationMs, Next next);
    void repeat(Node n, int64_t count, int64_t intervalMs, const std::string& body, Next next);
    void whileLoop(Node n, Cond condition, int64_t maxIterations, int64_t intervalMs, const std::string& body,
                   Next next);
    void parallel(Node n, std::vector<std::string> branches, Join join, Next next);
    void stop(Node n, StopScope scope, Next next);
    void stateGet(Node n, const StateRef& v, Next next);
    void stateSet(Node n, const StateRef& v, Expr value, Next next);
    void counter(Node n, const StateRef& v, CounterOp op, int64_t step, Next next);
    /** `logic.eval`: a pure block evaluated at this point of the run; `output` is its output name. */
    void eval(Node n, const std::string& output, Expr value, Next next);
    void inRange(Node n, Expr value, Expr low, Expr high, bool hysteresis, Next next);
    void log(Node n, std::optional<std::string> level, Expr message, Next next);
    void publish(Node n, const TopicRef& t, Expr payload, Next next);

    /** Internal: IR declarations executed by the runtime. */
    struct TriggerDef;
    struct NodeDef;

private:
    friend class Runtime;
    friend class Ctx;
    NodeDef& add(Node n, int kind, Next next);
    TriggerDef& addTrigger(Node n, int kind, Concurrency c, Outputs outputs, const std::string& entry);

    Runtime& m_rt;
    std::string m_id;
    std::string m_name;
    std::vector<std::unique_ptr<TriggerDef>> m_triggers;
    std::map<std::string, std::unique_ptr<NodeDef>> m_nodes;
    std::map<std::string, Value> m_state;
    std::map<std::string, Value> m_stateInitial;
    std::map<std::string, std::string> m_stateType;
};

struct RuntimeOptions {
    /** `runId` of trace events (virtual runs; the orchestrator assigns it for live runs). */
    std::string runId = "app";
};

/**
 * The app: workflows, signal cache, scheduler of runs. One per process (`AppBase`) or per test.
 */
class Runtime {
public:
    Runtime(Strand& strand, IVehicleAccess& vehicle, IPubSub& pubsub, ITraceSink& sink);
    ~Runtime();
    Runtime(const Runtime&) = delete;
    Runtime& operator=(const Runtime&) = delete;

    /** Declares a workflow (generated `bind`); workflows run in declaration order. */
    Workflow& workflow(const std::string& id, const std::string& name);

    /**
     * Reads the baselines, subscribes signals and topics, and posts the app start (app_start
     * triggers, timers, condition baselines) on the strand.
     */
    void start();
    /** Cancels every run; the strand keeps running other events. */
    void stopAll();
    bool stopped() const { return m_stopped; }

    Strand& strand() { return m_strand; }
    uint64_t runs() const { return m_runCount; }

    struct Impl;

private:
    friend class Workflow;
    friend class Ctx;
    std::unique_ptr<Impl> m_impl;
    Strand& m_strand;
    IVehicleAccess& m_vehicle;
    IPubSub& m_pubsub;
    ITraceSink& m_sink;
    std::vector<std::unique_ptr<Workflow>> m_workflows;
    uint64_t m_runCount = 0;
    bool m_stopped = false;
};

} // namespace simvehicleapp::rt

#endif // SIMVEHICLEAPP_RT_RUNTIME_HPP

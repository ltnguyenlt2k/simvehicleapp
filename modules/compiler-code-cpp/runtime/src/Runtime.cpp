// Copyright (c) 2026 SimVehicleApp contributors
// SPDX-License-Identifier: Apache-2.0

#include "simvehicleapp/rt/Runtime.hpp"

#include <algorithm>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <set>

namespace simvehicleapp::rt {

/*
 * Execution model (mirrors the simulator, ADR-0017 Notes §1–14): a run is a set of fibers (the
 * trigger's chain plus parallel branches) sharing a cancel token; a fiber runs synchronously until
 * it waits, then continues from a strand event. Everything here runs on the strand.
 */

namespace {

enum Kind {
    kAppStart,
    kSignalChanged,
    kTimer,
    kCondition,
    kMqtt,
    kRead,
    kWrite,
    kBranch,
    kSwitch,
    kWait,
    kWaitUntil,
    kStableFor,
    kRepeat,
    kWhile,
    kParallel,
    kStop,
    kStateGet,
    kStateSet,
    kCounter,
    kEval,
    kInRange,
    kLog,
    kPublish,
};

enum class Resume { None, Ok, Timeout, Done };

struct Token {
    bool cancelled = false;
    std::vector<std::weak_ptr<Token>> children;

    void cancel() {
        if (cancelled) {
            return;
        }
        cancelled = true;
        for (auto& w : children) {
            if (auto c = w.lock()) {
                c->cancel();
            }
        }
    }
    static std::shared_ptr<Token> child(const std::shared_ptr<Token>& parent) {
        auto t = std::make_shared<Token>();
        if (parent) {
            auto& ch = parent->children;
            // Long-running apps: drop tokens of finished runs now and then.
            if (ch.size() >= 64 && (ch.size() & (ch.size() - 1)) == 0) {
                ch.erase(std::remove_if(ch.begin(), ch.end(), [](const auto& w) { return w.expired(); }),
                         ch.end());
            }
            ch.push_back(t);
        }
        return t;
    }
};

struct Fiber;
using FiberP = std::shared_ptr<Fiber>;
using Cont = std::function<void(std::optional<std::string>)>;

} // namespace

struct Workflow::TriggerDef {
    std::string id;
    std::string blockId;
    int kind = kAppStart;
    Workflow* wf = nullptr;
    Concurrency concurrency;
    Outputs outputs;
    std::string entry;
    SignalRef signal;
    Change mode = Change::Any;
    std::optional<Value> threshold;
    int64_t debounceMs = 0;
    int64_t intervalMs = 0;
    int64_t initialDelayMs = 0;
    Cond condition;
    TopicRef topic;
    bool jsonPayload = false;
};

struct Workflow::NodeDef {
    std::string id;
    std::string blockId;
    int kind = kWait;
    std::map<std::string, std::string> next; // handle → node ("" = end); key presence matters
    SignalRef signal;
    TopicRef topic;
    StateRef state;
    Expr value;
    Expr low;
    Expr high;
    std::vector<Expr> cases;
    Cond condition;
    int64_t ms = 0;
    int64_t count = 0;
    int64_t maxIterations = 0;
    bool flag = false; // fresh / awaitAck / hysteresis
    OnError onError = OnError::Continue;
    bool hasOnError = false;
    std::string body;
    std::vector<std::string> branches;
    Join join = Join::All;
    StopScope scope = StopScope::Run;
    CounterOp counterOp = CounterOp::Inc;
    std::optional<std::string> level;
    std::string output; // logic.eval output name
};

using TriggerDef = Workflow::TriggerDef;
using NodeDef = Workflow::NodeDef;

struct RunState {
    uint64_t n = 0;
    TriggerDef* trigger = nullptr;
    std::shared_ptr<Token> token;
    std::map<std::string, Value> outputs; // node → {output: value}
    std::set<Fiber*> fibers;
    bool finished = false;
};
using RunP = std::shared_ptr<RunState>;

namespace {

struct Fiber {
    ~Fiber() {
        if (registry != nullptr) {
            registry->erase(this);
        }
        if (run) {
            run->fibers.erase(this);
        }
    }
    std::set<Fiber*>* registry = nullptr;
    RunP run;
    std::weak_ptr<Fiber> self;
    uint64_t order = 0; // creation order: `run.fibers` iterates like the simulator's Set
    std::shared_ptr<Token> token;
    bool done = false;
    std::vector<std::function<void()>> waiters;
    std::function<void()> onDone;
    std::function<void(Resume)> k;
};

struct Waiter {
    FiberP fiber;
    Workflow* wf;
    Cond cond;
    bool wantTrue;
    TimerId timer = 0;
    bool active = true;
};
using WaiterP = std::shared_ptr<Waiter>;

/** Thrown by `stop`/the loop guard: ends the fiber (`StopRun` of the simulator). */
struct StopRun {};

} // namespace

struct Runtime::Impl {
    Runtime& rt;
    std::map<std::string, Value> values; // path → latest value
    std::map<std::string, std::string> pathType;
    uint64_t traceSeq = 0;
    std::shared_ptr<Token> appToken = std::make_shared<Token>();
    // trigger → its runs, in the order the triggers first ran (Map semantics of the simulator)
    std::map<const Workflow*, std::vector<std::pair<TriggerDef*, std::vector<RunP>>>> runsOf;
    std::map<TriggerDef*, std::deque<std::function<void()>>> queues;
    std::vector<WaiterP> waiters;
    std::map<TriggerDef*, bool> conditionLast;
    std::map<TriggerDef*, TimerId> debounce;
    std::map<std::string, bool> hysteresis; // wf/node → state
    std::set<std::string> subscribedFilters;
    Fiber* current = nullptr; // fiber whose step is running
    std::set<Fiber*> live;     // every fiber not yet destroyed
    uint64_t fiberCount = 0;

    explicit Impl(Runtime& r)
        : rt(r) {}

    ~Impl() {
        // Fibers still waiting at shutdown hold their own continuation: break those cycles.
        std::vector<FiberP> held;
        for (auto* f : live) {
            if (auto p = f->self.lock()) {
                held.push_back(std::move(p));
            }
        }
        for (const auto& f : held) {
            f->k = nullptr;
            f->waiters.clear();
            f->onDone = nullptr;
        }
        // Events still queued on the strand may hold fibers past this point: detach them.
        for (auto* f : live) {
            f->registry = nullptr;
        }
        waiters.clear();
    }

    int64_t now() const { return rt.m_strand.nowMs(); }
    TimerId schedule(int64_t at, std::function<void()> fn) { return rt.m_strand.postAt(at, std::move(fn)); }

    std::vector<TriggerDef*> triggers() const {
        std::vector<TriggerDef*> out;
        for (const auto& wf : rt.m_workflows) {
            for (const auto& t : wf->m_triggers) {
                out.push_back(t.get());
            }
        }
        return out;
    }

    // ---- tracing --------------------------------------------------------------------------
    void trace(const std::string& ev, const RunState* run, const std::string& wf, const std::string& node,
               const std::string& blockId, std::optional<Value> data = std::nullopt) {
        TraceRecord r;
        r.seq = traceSeq++;
        r.ts = now();
        r.ev = ev;
        if (run != nullptr || !node.empty()) {
            r.wf = wf;
            r.run = run != nullptr ? static_cast<int64_t>(run->n) : 0;
        }
        r.node = node;
        r.blockId = blockId;
        r.data = std::move(data);
        rt.m_sink.trace(r);
    }
    void traceNode(const std::string& ev, RunState& run, const NodeDef& node, std::optional<Value> data = {}) {
        trace(ev, &run, run.trigger->wf->id(), node.id, node.blockId, std::move(data));
    }

    // ---- inputs, signals, triggers -------------------------------------------------------
    void startApp() {
        for (auto* t : triggers()) {
            if (t->kind == kAppStart) {
                fire(t, Value::object());
            }
            if (t->kind == kTimer) {
                scheduleTick(t, t->initialDelayMs, 1);
            }
            if (t->kind == kCondition) {
                conditionLast[t] = safeBool(*t->wf, t->condition);
            }
        }
    }

    void scheduleTick(TriggerDef* t, int64_t at, int64_t tick) {
        schedule(at, [this, t, at, tick] {
            Value o = Value::object();
            o["tick"] = tick;
            o["timestamp"] = now();
            fire(t, std::move(o));
            scheduleTick(t, at + t->intervalMs, tick + 1);
        });
    }

    /** `eq` of the simulator: undefined never equals; integers by decimal text; objects never `===`. */
    static bool sameValue(const Value* a, const Value& b) {
        if (a == nullptr) {
            return false;
        }
        if (a->is_null() || b.is_null()) {
            return a->is_null() && b.is_null();
        }
        const bool ai = a->is_number_integer() || a->is_number_unsigned();
        const bool bi = b.is_number_integer() || b.is_number_unsigned();
        if (ai || bi) {
            return formatValue(*a, "") == formatValue(b, "");
        }
        if (a->is_array() || a->is_object()) {
            return false; // distinct objects are never `===`
        }
        if (a->is_number_float() && b.is_number_float()) {
            return a->get<double>() == b.get<double>();
        }
        return *a == b;
    }

    bool modeMatches(const TriggerDef& t, const Value* prev, const Value& next) {
        const auto n = [](const Value& v) { return toNumber(v); };
        const Value th = t.threshold ? *t.threshold : Value(std::numeric_limits<double>::quiet_NaN());
        switch (t.mode) {
        case Change::Any:
            return !sameValue(prev, next);
        case Change::Rising:
            return prev != nullptr && n(next) > n(*prev);
        case Change::Falling:
            return prev != nullptr && n(next) < n(*prev);
        case Change::CrossesAbove:
            return prev != nullptr && n(*prev) <= n(th) && n(th) < n(next);
        case Change::CrossesBelow:
            return prev != nullptr && n(*prev) >= n(th) && n(th) > n(next);
        case Change::Becomes:
            return t.threshold && sameValue(&next, th) && !sameValue(prev, th);
        }
        return false;
    }

    void applyInput(const std::string& path, const Value& incoming) {
        const auto typeIt = pathType.find(path);
        if (typeIt == pathType.end()) {
            return; // a signal the app does not use
        }
        std::optional<Value> prev;
        if (auto it = values.find(path); it != values.end()) {
            prev = it->second;
        }
        const Value next = incoming;
        values[path] = next;
        for (auto* t : triggers()) {
            if (t->kind != kSignalChanged || t->signal.path != path) {
                continue;
            }
            if (!modeMatches(*t, prev ? &*prev : nullptr, next)) {
                continue;
            }
            Value outputs = Value::object();
            outputs["value"] = next;
            outputs["previous"] = prev ? *prev : Value();
            outputs["timestamp"] = now();
            if (t->debounceMs > 0) {
                if (auto old = debounce.find(t); old != debounce.end()) {
                    rt.m_strand.cancel(old->second);
                }
                debounce[t] = schedule(now() + t->debounceMs, [this, t, outputs, path]() mutable {
                    debounce.erase(t);
                    auto v = values.find(path);
                    outputs["value"] = v != values.end() ? v->second : Value();
                    outputs["timestamp"] = now();
                    fire(t, outputs);
                });
            } else {
                fire(t, outputs);
            }
        }
        afterChange();
    }

    /** After a signal/state change: condition triggers (rising edge) and waiting fibers. */
    void afterChange() {
        for (auto* t : triggers()) {
            if (t->kind != kCondition) {
                continue;
            }
            const bool nowTrue = safeBool(*t->wf, t->condition);
            const bool before = conditionLast.count(t) > 0 ? conditionLast[t] : false;
            conditionLast[t] = nowTrue;
            if (nowTrue && !before) {
                if (t->debounceMs > 0) {
                    debounce[t] = schedule(now() + t->debounceMs, [this, t] {
                        debounce.erase(t);
                        if (safeBool(*t->wf, t->condition)) {
                            Value o = Value::object();
                            o["timestamp"] = now();
                            fire(t, o);
                        }
                    });
                } else {
                    Value o = Value::object();
                    o["timestamp"] = now();
                    fire(t, o);
                }
            } else if (!nowTrue) {
                if (auto it = debounce.find(t); it != debounce.end()) {
                    rt.m_strand.cancel(it->second);
                    debounce.erase(it);
                }
            }
        }
        const auto snapshot = waiters;
        for (const auto& w : snapshot) {
            // A nested change (a resumed run that sets state) may already have resumed or dropped it.
            if (!w->active) {
                continue;
            }
            if (w->fiber->token->cancelled) {
                removeWaiter(w);
                continue;
            }
            if (safeCond(*w->wf, w->fiber->run.get(), w->cond) == w->wantTrue) {
                removeWaiter(w);
                rt.m_strand.cancel(w->timer);
                step(w->fiber, Resume::Ok);
            }
        }
    }

    void removeWaiter(const WaiterP& w) {
        w->active = false;
        waiters.erase(std::remove(waiters.begin(), waiters.end(), w), waiters.end());
    }

    void deliverMqtt(const std::string& topic, const std::string& payload, const std::string* onlyFilter) {
        for (auto* t : triggers()) {
            if (t->kind != kMqtt) {
                continue;
            }
            const bool match = onlyFilter != nullptr ? t->topic.topic == *onlyFilter : topicMatches(t->topic.topic, topic);
            if (!match) {
                continue;
            }
            Value value = payload;
            if (t->jsonPayload) {
                try {
                    value = jsParse(payload);
                } catch (const std::exception&) {
                    Value d = Value::object();
                    d["reason"] = "payload_not_json";
                    d["topic"] = topic;
                    trace("error", nullptr, t->wf->id(), t->id, t->blockId, d);
                    continue;
                }
            }
            Value o = Value::object();
            o["payload"] = value;
            o["topic"] = topic;
            fire(t, o);
        }
    }

    /** `JSON.parse`: numbers become doubles like in JavaScript. */
    static Value jsParse(const std::string& text) {
        Value v = Value::parse(text);
        std::function<void(Value&)> fix = [&](Value& x) {
            if (x.is_number_integer() || x.is_number_unsigned()) {
                x = toNumber(x);
            } else if (x.is_structured()) {
                for (auto& c : x) {
                    fix(c);
                }
            }
        };
        fix(v);
        return v;
    }

    // ---- concurrency ------------------------------------------------------------------------
    std::vector<RunP>& runsFor(TriggerDef* t) {
        auto& list = runsOf[t->wf];
        for (auto& [trig, runs] : list) {
            if (trig == t) {
                return runs;
            }
        }
        list.emplace_back(t, std::vector<RunP>{});
        return list.back().second;
    }

    std::vector<RunP> active(TriggerDef* t) {
        std::vector<RunP> out;
        for (auto& r : runsFor(t)) {
            if (!r->finished) {
                out.push_back(r);
            }
        }
        return out;
    }

    void fire(TriggerDef* t, Value outputs) {
        if (rt.m_stopped) {
            return;
        }
        const auto act = active(t);
        auto start = [this, t, outputs] { startRun(t, outputs); };
        if (t->kind == kAppStart || act.empty()) {
            start();
            return;
        }
        switch (t->concurrency.policy) {
        case Policy::Restart:
            for (const auto& r : act) {
                cancelRun(*r, "restart");
            }
            start();
            return;
        case Policy::Ignore:
            return;
        case Policy::Queue: {
            auto& q = queues[t];
            if (static_cast<int>(q.size()) >= t->concurrency.queueMax) {
                q.pop_front();
                Value d = Value::object();
                d["reason"] = "queue_overflow";
                trace("error", nullptr, t->wf->id(), t->id, t->blockId, d);
            }
            q.push_back(start);
            return;
        }
        case Policy::Parallel:
            if (static_cast<int>(act.size()) >= t->concurrency.maxRuns) {
                return;
            }
            start();
            return;
        }
    }

    void startRun(TriggerDef* t, const Value& outputs) {
        auto run = std::make_shared<RunState>();
        run->n = ++rt.m_runCount;
        run->trigger = t;
        run->token = Token::child(appToken);
        run->outputs[t->id] = outputs;
        auto& runs = runsFor(t);
        runs.erase(std::remove_if(runs.begin(), runs.end(), [](const RunP& r) { return r->finished; }), runs.end());
        runs.push_back(run);
        Value json = Value::object();
        for (auto it = outputs.begin(); it != outputs.end(); ++it) {
            std::string type;
            for (const auto& [name, ty] : t->outputs) {
                if (name == it.key()) {
                    type = ty;
                }
            }
            json[it.key()] = toJson(it.value(), type);
        }
        Value d = Value::object();
        d["outputs"] = json;
        trace("trigger", run.get(), t->wf->id(), t->id, t->blockId, d);
        spawn(run, run->token, t->entry);
    }

    void cancelRun(RunState& run, const char* reason) {
        if (run.finished) {
            return;
        }
        run.token->cancel();
        run.finished = true;
        Value d = Value::object();
        d["reason"] = reason;
        trace("cancel", &run, run.trigger->wf->id(), run.trigger->id, run.trigger->blockId, d);
        // Its waiting fibers end now: a long-running app must not keep one per restart.
        reap(run, current);
    }

    void finishRun(RunState& run) {
        if (run.finished) {
            return;
        }
        run.finished = true;
        auto it = queues.find(run.trigger);
        if (it != queues.end() && !it->second.empty()) {
            auto next = std::move(it->second.front());
            it->second.pop_front();
            next();
        }
    }

    // ---- fibers --------------------------------------------------------------------------------
    FiberP newFiber(const RunP& run, std::shared_ptr<Token> token) {
        auto f = std::make_shared<Fiber>();
        f->run = run;
        f->self = f;
        f->order = ++fiberCount;
        f->registry = &live;
        live.insert(f.get());
        f->token = std::move(token);
        run->fibers.insert(f.get());
        Fiber* raw = f.get();
        RunState* r = run.get();
        f->onDone = [this, raw, r] {
            r->fibers.erase(raw);
            if (r->fibers.empty()) {
                finishRun(*r);
            }
        };
        return f;
    }

    void spawn(const RunP& run, std::shared_ptr<Token> token, const std::string& entry) {
        auto f = newFiber(run, std::move(token));
        f->k = [this, f, entry](Resume) { chain(f, entry, [this, f] { complete(f); }); };
        step(f, Resume::None);
    }

    /** Parallel branch: a child fiber started at the same instant, after the parent's current step. */
    FiberP spawnLater(const RunP& run, const std::string& entry) {
        auto f = newFiber(run, Token::child(run->token));
        f->k = [this, f, entry](Resume) { chain(f, entry, [this, f] { complete(f); }); };
        schedule(now(), [this, f] { step(f, Resume::None); });
        return f;
    }

    void step(const FiberP& f, Resume input) {
        if (f->done) {
            f->k = nullptr;
            return;
        }
        if (f->token->cancelled) {
            complete(f);
            return;
        }
        auto k = std::move(f->k);
        f->k = nullptr;
        if (!k) {
            return;
        }
        Fiber* outer = current;
        current = f.get();
        try {
            k(input);
        } catch (const StopRun&) {
            current = outer;
            complete(f);
            return;
        }
        current = outer;
    }

    /**
     * Cancelled fibers end when they are cancelled (their timers never resume them), so the run ends
     * as soon as its last live fiber does (simulator `reap`, analysis/07 §4).
     */
    void reap(RunState& run, const Fiber* except) {
        std::vector<FiberP> live;
        for (auto* f : run.fibers) {
            if (f != except && f->token->cancelled && !f->done) {
                live.push_back(f->self.lock());
            }
        }
        std::sort(live.begin(), live.end(), [](const FiberP& a, const FiberP& b) { return a->order < b->order; });
        for (const auto& f : live) {
            if (f) {
                complete(f);
            }
        }
    }

    void complete(const FiberP& f) {
        if (f->done) {
            return;
        }
        f->done = true;
        f->k = nullptr;
        const auto ws = f->waiters;
        for (const auto& w : ws) {
            w();
        }
        if (f->onDone) {
            f->onDone();
        }
    }

    /** Yields: the fiber continues with `k` when the strand resumes it. */
    void sleep(const FiberP& f, int64_t ms, std::function<void(Resume)> k) {
        f->k = std::move(k);
        schedule(now() + ms, [this, f] { step(f, Resume::None); });
    }

    void until(const FiberP& f, Workflow& wf, Cond cond, int64_t timeoutMs, bool wantTrue,
               std::function<void(Resume)> k) {
        f->k = std::move(k);
        auto w = std::make_shared<Waiter>();
        w->fiber = f;
        w->wf = &wf;
        w->cond = std::move(cond);
        w->wantTrue = wantTrue;
        w->timer = schedule(now() + timeoutMs, [this, w] {
            if (!w->active) {
                return;
            }
            removeWaiter(w);
            step(w->fiber, Resume::Timeout);
        });
        waiters.push_back(w);
    }

    void join(const FiberP& f, const std::vector<FiberP>& children, Join mode, std::function<void(Resume)> k) {
        f->k = std::move(k);
        std::vector<FiberP> pending;
        for (const auto& c : children) {
            if (!c->done) {
                pending.push_back(c);
            }
        }
        if (mode == Join::All && pending.empty()) {
            schedule(now(), [this, f] { step(f, Resume::Done); });
            return;
        }
        if (mode == Join::Any && pending.size() < children.size()) {
            for (const auto& c : pending) {
                c->token->cancel();
            }
            reap(*f->run, nullptr);
            schedule(now(), [this, f] { step(f, Resume::Done); });
            return;
        }
        auto resumed = std::make_shared<bool>(false);
        for (const auto& c : pending) {
            c->waiters.push_back([this, f, children, mode, resumed] {
                if (*resumed) {
                    return;
                }
                std::vector<FiberP> left;
                for (const auto& x : children) {
                    if (!x->done) {
                        left.push_back(x);
                    }
                }
                if (mode == Join::Any || left.empty()) {
                    *resumed = true;
                    if (mode == Join::Any) {
                        for (const auto& x : left) {
                            x->token->cancel();
                        }
                        reap(*f->run, nullptr);
                    }
                    schedule(now(), [this, f] { step(f, Resume::Done); });
                }
            });
        }
    }

    // ---- evaluation ------------------------------------------------------------------------------
    bool safeBool(Workflow& wf, const Cond& cond) { return safeCond(wf, nullptr, cond); }

    bool safeCond(Workflow& wf, RunState* run, const Cond& cond) {
        if (!cond) {
            return false;
        }
        Ctx c(rt, wf, run);
        try {
            return cond(c);
        } catch (const EvalError&) {
            return false;
        }
    }

    // ---- interpreter -----------------------------------------------------------------------------
    /** Runs the chain from `id`; `end` runs when it returns (normally or because the run was cancelled). */
    void chain(const FiberP& f, const std::string& id, std::function<void()> end) {
        RunState& run = *f->run;
        if (id.empty() || run.token->cancelled) {
            end();
            return;
        }
        Workflow& wf = *run.trigger->wf;
        NodeDef& node = *wf.m_nodes.at(id);
        traceNode("enter", run, node);
        exec(f, node, [this, f, &node, end](std::optional<std::string> handle) {
            RunState& r = *f->run;
            if (r.token->cancelled) {
                end();
                return;
            }
            if (handle) {
                Value d = Value::object();
                d["handle"] = *handle;
                traceNode("exit", r, node, d);
            } else {
                traceNode("exit", r, node);
            }
            std::string nextId;
            if (handle) {
                auto it = node.next.find(*handle);
                if (it != node.next.end()) {
                    nextId = it->second;
                }
            }
            chain(f, nextId, end);
        });
    }

    /** I/O error: `error` branch when connected, else `onError` (continue = log + next, stop = end run). */
    std::optional<std::string> onError(RunState& run, const NodeDef& node, const std::string& reason,
                                       const std::string& message) {
        Value& out = run.outputs[node.id];
        if (!out.is_object()) {
            out = Value::object();
        }
        out["ok"] = false;
        out["error"] = message;
        Value d = Value::object();
        d["reason"] = reason;
        d["message"] = message;
        traceNode("error", run, node, d);
        if (auto it = node.next.find("error"); it != node.next.end() && !it->second.empty()) {
            return std::string("error");
        }
        if (node.hasOnError && node.onError == OnError::Stop) {
            return std::nullopt;
        }
        if (node.next.count("next") > 0) {
            return std::string("next");
        }
        return std::nullopt;
    }

    void exec(const FiberP& f, NodeDef& node, const Cont& k) {
        RunState& run = *f->run;
        Workflow& wf = *run.trigger->wf;
        Ctx c(rt, wf, &run);
        auto fail = [&](const EvalError& e) { k(onError(run, node, e.reason(), e.what())); };
        switch (node.kind) {
        case kWrite: {
            Value v;
            std::string rejected;
            try {
                v = node.value(c);
                rejected = rt.m_vehicle.checkWrite(node.signal.path, node.signal.type, v);
                if (!rejected.empty()) {
                    throw EvalError("no_value", rejected);
                }
            } catch (const EvalError& e) {
                fail(e);
                return;
            }
            Value d = Value::object();
            d["path"] = node.signal.path;
            d["value"] = toJson(v, node.signal.type);
            if (!node.flag) {
                rt.m_vehicle.set(node.signal.path, node.signal.type, v, nullptr);
            }
            traceNode("write", run, node, d);
            Value o = Value::object();
            o["ok"] = true;
            o["error"] = "";
            run.outputs[node.id] = o;
            if (node.flag) {
                auto error = std::make_shared<std::string>();
                f->k = [this, f, &node, k, error](Resume) {
                    if (!error->empty()) {
                        k(onError(*f->run, node, "write_failed", *error));
                        return;
                    }
                    k(std::string("next"));
                };
                rt.m_vehicle.set(node.signal.path, node.signal.type, v, [this, f, error](const std::string& err) {
                    *error = err;
                    step(f, Resume::None);
                });
                return;
            }
            k(std::string("next"));
            return;
        }
        case kRead: {
            auto finish = [this, f, &node, k](const std::optional<Value>& v) {
                RunState& r = *f->run;
                if (!v || v->is_null()) {
                    k(onError(r, node, "no_value", node.signal.path + " has no value yet"));
                    return;
                }
                Value o = Value::object();
                o["value"] = *v;
                o["timestamp"] = now();
                r.outputs[node.id] = o;
                k(std::string("next"));
            };
            if (node.flag) {
                auto got = std::make_shared<std::optional<Value>>();
                auto error = std::make_shared<std::string>();
                f->k = [this, f, &node, k, got, error, finish](Resume) {
                    if (!error->empty()) {
                        k(onError(*f->run, node, "read_failed", *error));
                        return;
                    }
                    finish(*got);
                };
                rt.m_vehicle.get(node.signal.path, node.signal.type,
                                 [this, f, got, error](std::optional<Value> v, const std::string& err) {
                                     *got = std::move(v);
                                     *error = err;
                                     step(f, Resume::None);
                                 });
                return;
            }
            auto it = values.find(node.signal.path);
            finish(it != values.end() ? std::optional<Value>(it->second) : std::nullopt);
            return;
        }
        case kBranch: {
            bool b = false;
            try {
                b = node.condition(c);
            } catch (const EvalError& e) {
                fail(e);
                return;
            }
            k(std::string(b ? "then" : "else"));
            return;
        }
        case kSwitch: {
            std::string handle = "default";
            try {
                const Value v = node.value(c);
                for (size_t i = 0; i < node.cases.size(); ++i) {
                    if (switchMatch(v, node.cases[i](c))) {
                        handle = "case_" + std::to_string(i);
                        break;
                    }
                }
            } catch (const EvalError& e) {
                fail(e);
                return;
            }
            k(handle);
            return;
        }
        case kWait:
            sleep(f, node.ms, [k](Resume) { k(std::string("next")); });
            return;
        case kWaitUntil: {
            if (safeCond(wf, &run, node.condition)) {
                k(std::string("ok"));
                return;
            }
            until(f, wf, node.condition, node.ms, true,
                  [k](Resume r) { k(std::string(r == Resume::Ok ? "ok" : "timeout")); });
            return;
        }
        case kStableFor: {
            if (!safeCond(wf, &run, node.condition)) {
                k(std::string("broken"));
                return;
            }
            until(f, wf, node.condition, node.ms, false,
                  [k](Resume r) { k(std::string(r == Resume::Ok ? "broken" : "stable")); });
            return;
        }
        case kRepeat:
            repeatStep(f, node, 0, k);
            return;
        case kWhile:
            whileStep(f, node, 0, k);
            return;
        case kParallel: {
            std::vector<FiberP> children;
            for (const auto& entry : node.branches) {
                children.push_back(spawnLater(f->run, entry));
            }
            if (node.join == Join::None) {
                k(std::string("next"));
                return;
            }
            join(f, children, node.join, [k](Resume) { k(std::string("next")); });
            return;
        }
        case kStop: {
            if (node.scope == StopScope::App) {
                rt.m_stopped = true;
                appToken->cancel();
                rt.m_strand.stop();
            } else if (node.scope == StopScope::Workflow) {
                for (auto& [trig, runs] : runsOf[&wf]) {
                    const auto copy = runs;
                    for (const auto& r : copy) {
                        if (r.get() != &run) {
                            cancelRun(*r, "stop");
                        }
                    }
                }
            }
            run.token->cancel();
            reap(run, current);
            throw StopRun{};
        }
        case kStateGet: {
            Value o = Value::object();
            auto it = wf.m_state.find(node.state.id);
            o["value"] = it != wf.m_state.end() ? it->second : Value();
            run.outputs[node.id] = o;
            k(std::string("next"));
            return;
        }
        case kStateSet: {
            Value v;
            try {
                v = node.value(c);
            } catch (const EvalError& e) {
                fail(e);
                return;
            }
            wf.m_state[node.state.id] = v;
            afterChange();
            k(std::string("next"));
            return;
        }
        case kCounter: {
            const std::string& type = node.state.type;
            Value next;
            if (node.counterOp == CounterOp::Reset) {
                next = fromJson(wf.m_stateInitial[node.state.id], type);
            } else {
                const Value& curV = wf.m_state[node.state.id];
                __extension__ typedef __int128 i128;
                i128 cur = 0;
                if (curV.is_number_unsigned()) {
                    cur = static_cast<i128>(curV.get<uint64_t>());
                } else if (curV.is_number_integer()) {
                    cur = curV.get<int64_t>();
                } else {
                    cur = static_cast<i128>(toNumber(curV));
                }
                const i128 r = node.counterOp == CounterOp::Dec ? cur - node.count : cur + node.count;
                if (r < 0) {
                    const i128 m = -r;
                    next = castValue(m > static_cast<i128>(INT64_MAX) ? Value(-1e300) : Value(-static_cast<int64_t>(m)),
                                     type, "");
                } else {
                    next = castValue(r > static_cast<i128>(UINT64_MAX) ? Value(1e300) : Value(static_cast<uint64_t>(r)),
                                     type, "");
                }
            }
            wf.m_state[node.state.id] = next;
            Value o = Value::object();
            o["value"] = next;
            run.outputs[node.id] = o;
            afterChange();
            k(std::string("next"));
            return;
        }
        case kEval: {
            Value v;
            try {
                v = node.value(c);
            } catch (const EvalError& e) {
                fail(e);
                return;
            }
            Value o = Value::object();
            o[node.output.empty() ? std::string("result") : node.output] = v;
            run.outputs[node.id] = o;
            k(std::string("next"));
            return;
        }
        case kInRange: {
            bool result = false;
            try {
                const double v = toNumber(node.value(c));
                const double lo = toNumber(node.low(c));
                const double hi = toNumber(node.high(c));
                if (node.flag) {
                    bool& s = hysteresis[wf.id() + "/" + node.id];
                    if (v >= hi) {
                        s = true;
                    } else if (v <= lo) {
                        s = false;
                    }
                    result = s;
                } else {
                    result = lo <= v && v <= hi;
                }
            } catch (const EvalError& e) {
                fail(e);
                return;
            }
            Value o = Value::object();
            o["result"] = result;
            o["state"] = result;
            run.outputs[node.id] = o;
            k(std::string("next"));
            return;
        }
        case kLog: {
            std::string message;
            try {
                message = formatValue(node.value(c), "string");
            } catch (const EvalError& e) {
                fail(e);
                return;
            }
            rt.m_sink.log(now(), node.level ? *node.level : "info", message);
            Value d = Value::object();
            d["kind"] = "log";
            if (node.level) {
                d["level"] = *node.level;
            }
            d["message"] = message;
            traceNode("value", run, node, d);
            k(std::string("next"));
            return;
        }
        case kPublish: {
            std::string payload;
            try {
                payload = formatValue(node.value(c), "string");
            } catch (const EvalError& e) {
                fail(e);
                return;
            }
            Value d = Value::object();
            d["kind"] = "mqtt";
            d["topic"] = node.topic.topic;
            d["payload"] = payload;
            traceNode("value", run, node, d);
            rt.m_pubsub.publish(node.topic.topic, payload);
            k(std::string("next"));
            return;
        }
        default:
            throw std::logic_error("simvehicleapp runtime: node " + node.id + " has an unknown kind");
        }
    }

    /** `control.switch` case equality (simulator rule: integers exactly, numbers by value, else strict). */
    static bool switchMatch(const Value& v, const Value& c) {
        const bool vi = v.is_number_integer() || v.is_number_unsigned();
        const bool ci = c.is_number_integer() || c.is_number_unsigned();
        if (vi || ci) {
            if (formatValue(v, "") == formatValue(c, "") && !c.is_string()) {
                return true;
            }
            return toNumber(v) == toNumber(c) && !v.is_string();
        }
        if (v.is_number_float() && c.is_number_float()) {
            return v.get<double>() == c.get<double>();
        }
        if (v.type() != c.type() || v.is_structured()) {
            return false;
        }
        return v == c;
    }

    void repeatStep(const FiberP& f, NodeDef& node, int64_t i, const Cont& k) {
        RunState& run = *f->run;
        if (!(i < node.count && !run.token->cancelled)) {
            k(std::string("next"));
            return;
        }
        auto body = [this, f, &node, i, k](Resume) {
            Value o = Value::object();
            o["index"] = i;
            f->run->outputs[node.id] = o;
            chain(f, node.body, [this, f, &node, i, k] {
                sleep(f, 0, [this, f, &node, i, k](Resume) { repeatStep(f, node, i + 1, k); });
            });
        };
        if (i > 0 && node.ms > 0) {
            sleep(f, node.ms, body);
        } else {
            body(Resume::None);
        }
    }

    void whileStep(const FiberP& f, NodeDef& node, int64_t i, const Cont& k) {
        RunState& run = *f->run;
        if (run.token->cancelled) {
            k(std::string("next"));
            return;
        }
        auto body = [this, f, &node, i, k](Resume) {
            RunState& r = *f->run;
            Workflow& wf = *r.trigger->wf;
            Ctx c(rt, wf, &r);
            bool go = false;
            try {
                go = node.condition(c);
            } catch (const EvalError& e) {
                k(onError(r, node, e.reason(), e.what()));
                return;
            }
            if (!go) {
                k(std::string("next"));
                return;
            }
            if (i >= node.maxIterations) {
                Value d = Value::object();
                d["reason"] = "loop_guard";
                d["maxIterations"] = node.maxIterations;
                traceNode("error", r, node, d);
                r.token->cancel();
                reap(r, current);
                throw StopRun{};
            }
            Value o = Value::object();
            o["index"] = i;
            r.outputs[node.id] = o;
            chain(f, node.body, [this, f, &node, i, k] {
                sleep(f, 0, [this, f, &node, i, k](Resume) { whileStep(f, node, i + 1, k); });
            });
        };
        if (i > 0 && node.ms > 0) {
            sleep(f, node.ms, body);
        } else {
            body(Resume::None);
        }
    }
};

// ---- Ctx ---------------------------------------------------------------------------------------

int64_t Ctx::nowMs() const { return m_rt.m_strand.nowMs(); }

const Value& Ctx::outValue(const char* node, const char* output) const {
    if (m_run != nullptr) {
        auto it = m_run->outputs.find(node);
        if (it != m_run->outputs.end() && it->second.is_object()) {
            auto o = it->second.find(output);
            if (o != it->second.end() && !o->is_null()) {
                return *o;
            }
        }
    }
    throw EvalError("no_value", std::string(node) + "." + output + " has no value");
}

const Value& Ctx::signalValue(const SignalRef& s) const {
    auto& values = m_rt.m_impl->values;
    auto it = values.find(s.path);
    if (it == values.end() || it->second.is_null()) {
        throw EvalError("no_value", "signal " + s.id + " has no value yet");
    }
    return it->second;
}

const Value& Ctx::stateValue(const StateRef& v) const {
    static const Value null;
    auto it = m_wf.m_state.find(v.id);
    return it != m_wf.m_state.end() ? it->second : null;
}

// ---- Workflow builder ------------------------------------------------------------------------------

Workflow::Workflow(Runtime& rt, std::string id, std::string name)
    : m_rt(rt)
    , m_id(std::move(id))
    , m_name(std::move(name)) {}

SignalRef Workflow::signal(const std::string& id, const std::string& path, const std::string& type) {
    m_rt.m_impl->pathType.emplace(path, type);
    return SignalRef{id, path, type};
}

TopicRef Workflow::topic(const std::string& id, const std::string& topic) { return TopicRef{id, topic}; }

StateRef Workflow::state(const std::string& id, const std::string& type, const Value& initial) {
    m_stateInitial[id] = initial;
    m_state[id] = fromJson(initial, type);
    m_stateType[id] = type;
    return StateRef{id, type};
}

Workflow::TriggerDef& Workflow::addTrigger(Node n, int kind, Concurrency c, Outputs outputs, const std::string& entry) {
    auto t = std::make_unique<TriggerDef>();
    t->id = n.id;
    t->blockId = n.blockId;
    t->kind = kind;
    t->wf = this;
    t->concurrency = c;
    t->outputs = std::move(outputs);
    t->entry = entry;
    m_triggers.push_back(std::move(t));
    return *m_triggers.back();
}

Workflow::NodeDef& Workflow::add(Node n, int kind, Next next) {
    auto d = std::make_unique<NodeDef>();
    d->id = n.id;
    d->blockId = n.blockId;
    d->kind = kind;
    for (auto& [h, to] : next) {
        d->next[h] = to;
    }
    auto& ref = *d;
    m_nodes[n.id] = std::move(d);
    return ref;
}

void Workflow::onAppStart(Node n, Concurrency c, Outputs outputs, const std::string& entry) {
    addTrigger(n, kAppStart, c, std::move(outputs), entry);
}

void Workflow::onSignalChanged(Node n, const SignalRef& s, Change mode, std::optional<Value> threshold,
                               int64_t debounceMs, Concurrency c, Outputs outputs, const std::string& entry) {
    auto& t = addTrigger(n, kSignalChanged, c, std::move(outputs), entry);
    t.signal = s;
    t.mode = mode;
    t.threshold = std::move(threshold);
    t.debounceMs = debounceMs;
}

void Workflow::onTimer(Node n, int64_t intervalMs, int64_t initialDelayMs, Concurrency c, Outputs outputs,
                       const std::string& entry) {
    auto& t = addTrigger(n, kTimer, c, std::move(outputs), entry);
    t.intervalMs = intervalMs;
    t.initialDelayMs = initialDelayMs;
}

void Workflow::onCondition(Node n, Cond condition, int64_t debounceMs, Concurrency c, Outputs outputs,
                           const std::string& entry) {
    auto& t = addTrigger(n, kCondition, c, std::move(outputs), entry);
    t.condition = std::move(condition);
    t.debounceMs = debounceMs;
}

void Workflow::onMqtt(Node n, const TopicRef& topic, bool jsonPayload, Concurrency c, Outputs outputs,
                      const std::string& entry) {
    auto& t = addTrigger(n, kMqtt, c, std::move(outputs), entry);
    t.topic = topic;
    t.jsonPayload = jsonPayload;
}

void Workflow::read(Node n, const SignalRef& s, bool fresh, Next next) {
    auto& d = add(n, kRead, std::move(next));
    d.signal = s;
    d.flag = fresh;
}

void Workflow::write(Node n, const SignalRef& s, Expr value, bool awaitAck, OnError onError, Next next) {
    auto& d = add(n, kWrite, std::move(next));
    d.signal = s;
    d.value = std::move(value);
    d.flag = awaitAck;
    d.onError = onError;
    d.hasOnError = true;
}

void Workflow::branch(Node n, Cond condition, Next next) {
    add(n, kBranch, std::move(next)).condition = std::move(condition);
}

void Workflow::switchOn(Node n, Expr value, std::vector<Expr> cases, Next next) {
    auto& d = add(n, kSwitch, std::move(next));
    d.value = std::move(value);
    d.cases = std::move(cases);
}

void Workflow::wait(Node n, int64_t durationMs, Next next) { add(n, kWait, std::move(next)).ms = durationMs; }

void Workflow::waitUntil(Node n, Cond condition, int64_t timeoutMs, Next next) {
    auto& d = add(n, kWaitUntil, std::move(next));
    d.condition = std::move(condition);
    d.ms = timeoutMs;
}

void Workflow::stableFor(Node n, Cond condition, int64_t durationMs, Next next) {
    auto& d = add(n, kStableFor, std::move(next));
    d.condition = std::move(condition);
    d.ms = durationMs;
}

void Workflow::repeat(Node n, int64_t count, int64_t intervalMs, const std::string& body, Next next) {
    auto& d = add(n, kRepeat, std::move(next));
    d.count = count;
    d.ms = intervalMs;
    d.body = body;
}

void Workflow::whileLoop(Node n, Cond condition, int64_t maxIterations, int64_t intervalMs, const std::string& body,
                         Next next) {
    auto& d = add(n, kWhile, std::move(next));
    d.condition = std::move(condition);
    d.maxIterations = maxIterations;
    d.ms = intervalMs;
    d.body = body;
}

void Workflow::parallel(Node n, std::vector<std::string> branches, Join join, Next next) {
    auto& d = add(n, kParallel, std::move(next));
    d.branches = std::move(branches);
    d.join = join;
}

void Workflow::stop(Node n, StopScope scope, Next next) { add(n, kStop, std::move(next)).scope = scope; }

void Workflow::stateGet(Node n, const StateRef& v, Next next) { add(n, kStateGet, std::move(next)).state = v; }

void Workflow::stateSet(Node n, const StateRef& v, Expr value, Next next) {
    auto& d = add(n, kStateSet, std::move(next));
    d.state = v;
    d.value = std::move(value);
}

void Workflow::counter(Node n, const StateRef& v, CounterOp op, int64_t step, Next next) {
    auto& d = add(n, kCounter, std::move(next));
    d.state = v;
    d.counterOp = op;
    d.count = step;
}

void Workflow::eval(Node n, const std::string& output, Expr value, Next next) {
    auto& d = add(n, kEval, std::move(next));
    d.output = output;
    d.value = std::move(value);
}

void Workflow::inRange(Node n, Expr value, Expr low, Expr high, bool hysteresis, Next next) {
    auto& d = add(n, kInRange, std::move(next));
    d.value = std::move(value);
    d.low = std::move(low);
    d.high = std::move(high);
    d.flag = hysteresis;
}

void Workflow::log(Node n, std::optional<std::string> level, Expr message, Next next) {
    auto& d = add(n, kLog, std::move(next));
    d.level = std::move(level);
    d.value = std::move(message);
}

void Workflow::publish(Node n, const TopicRef& t, Expr payload, Next next) {
    auto& d = add(n, kPublish, std::move(next));
    d.topic = t;
    d.value = std::move(payload);
}

// ---- Runtime ------------------------------------------------------------------------------------------

Runtime::Runtime(Strand& strand, IVehicleAccess& vehicle, IPubSub& pubsub, ITraceSink& sink)
    : m_impl(std::make_unique<Impl>(*this))
    , m_strand(strand)
    , m_vehicle(vehicle)
    , m_pubsub(pubsub)
    , m_sink(sink) {}

Runtime::~Runtime() = default;

Workflow& Runtime::workflow(const std::string& id, const std::string& name) {
    m_workflows.push_back(std::make_unique<Workflow>(*this, id, name));
    return *m_workflows.back();
}

void Runtime::start() {
    auto& impl = *m_impl;
    for (const auto& [path, type] : impl.pathType) {
        if (auto v = m_vehicle.current(path, type)) {
            impl.values[path] = *v;
        }
    }
    for (const auto& [path, type] : impl.pathType) {
        const std::string p = path;
        m_vehicle.subscribe(path, type, [this, p](const Value& v) { m_impl->applyInput(p, v); });
    }
    m_pubsub.setHandler([this](const std::string& topic, const std::string& payload, const std::string* onlyFilter) {
        m_impl->deliverMqtt(topic, payload, onlyFilter);
    });
    for (auto* t : impl.triggers()) {
        if (t->kind == kMqtt && impl.subscribedFilters.insert(t->topic.topic).second) {
            m_pubsub.subscribe(t->topic.topic);
        }
    }
    m_strand.postAt(0, [this] { m_impl->startApp(); });
}

void Runtime::stopAll() {
    m_stopped = true;
    m_impl->appToken->cancel();
}

// ---- helpers ----------------------------------------------------------------------------------------------

bool topicMatches(const std::string& filter, const std::string& topic) {
    auto split = [](const std::string& s) {
        std::vector<std::string> out;
        size_t start = 0;
        for (;;) {
            const auto p = s.find('/', start);
            out.push_back(s.substr(start, p == std::string::npos ? std::string::npos : p - start));
            if (p == std::string::npos) {
                return out;
            }
            start = p + 1;
        }
    };
    const auto f = split(filter);
    const auto t = split(topic);
    for (size_t i = 0; i < f.size(); ++i) {
        if (f[i] == "#") {
            return true;
        }
        if (f[i] != "+" && (i >= t.size() || f[i] != t[i])) {
            return false;
        }
    }
    return f.size() == t.size();
}

StdoutTraceSink::StdoutTraceSink(std::string appName, TraceLevel level)
    : m_app(std::move(appName))
    , m_level(level) {}

TraceLevel StdoutTraceSink::levelFromEnv(TraceLevel fallback) {
    // The env can lower the level the project was generated with, never raise it (analysis/08 §3.2).
    const char* v = std::getenv("SV_TRACE_LEVEL");
    const std::string s = v != nullptr ? v : "";
    TraceLevel env = fallback;
    if (s == "off") {
        env = TraceLevel::Off;
    } else if (s == "trigger") {
        env = TraceLevel::Trigger;
    } else if (s == "node") {
        env = TraceLevel::Node;
    }
    return static_cast<int>(env) < static_cast<int>(fallback) ? env : fallback;
}

namespace {
std::mutex& stdoutMutex() {
    static std::mutex m;
    return m;
}
} // namespace

void StdoutTraceSink::trace(const TraceRecord& r) {
    // Lifecycle events (`app.*`, `vdb.*`) are always written: a live run needs them at every level.
    const bool lifecycle = r.ev.rfind("app.", 0) == 0 || r.ev.rfind("vdb.", 0) == 0;
    if (!lifecycle &&
        (m_level == TraceLevel::Off || (m_level == TraceLevel::Trigger && (r.ev == "enter" || r.ev == "exit")))) {
        return;
    }
    Value line = Value::object();
    line["v"] = 1;
    line["ts"] = epochMs();
    line["app"] = m_app;
    if (!r.wf.empty()) {
        line["wf"] = r.wf;
    }
    if (r.run) {
        line["run"] = *r.run;
    }
    if (!r.node.empty()) {
        line["node"] = r.node;
    }
    line["ev"] = r.ev;
    if (r.data) {
        line["data"] = *r.data;
    }
    const std::string text = "SVTRACE " + stringify(line) + "\n";
    std::lock_guard<std::mutex> lock(stdoutMutex());
    std::cout << text << std::flush;
}

void StdoutTraceSink::log(int64_t ts, const std::string& level, const std::string& message) {
    (void)ts;
    const std::string text = "[" + level + "] " + message + "\n";
    std::lock_guard<std::mutex> lock(stdoutMutex());
    std::cout << text << std::flush;
}

} // namespace simvehicleapp::rt

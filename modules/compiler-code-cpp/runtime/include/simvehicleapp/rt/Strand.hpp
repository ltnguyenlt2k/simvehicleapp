// Copyright (c) 2026 SimVehicleApp contributors
// SPDX-License-Identifier: Apache-2.0

#ifndef SIMVEHICLEAPP_RT_STRAND_HPP
#define SIMVEHICLEAPP_RT_STRAND_HPP

#include <condition_variable>
#include <cstdint>
#include <functional>
#include <mutex>
#include <set>
#include <vector>

namespace simvehicleapp::rt {

/** Milliseconds of the app clock: steady time for a real app, virtual time in tests. */
class IClock {
public:
    virtual ~IClock() = default;
    virtual int64_t nowMs() const = 0;
};

/** Monotonic milliseconds since the app started. */
class SteadyClock final : public IClock {
public:
    SteadyClock();
    int64_t nowMs() const override;

private:
    int64_t m_origin;
};

/** Wall clock in epoch milliseconds (trace `ts` of live runs, ADR-0027). */
int64_t epochMs();

using TimerId = uint64_t;

/**
 * Single-threaded event loop (ADR-0021 §2): every callback of the SDK and every timer of the app
 * runs here, one at a time, ordered by (due time, sequence). Events at the same instant run in the
 * order they were posted — the same order as the simulator (ADR-0017 Notes §1).
 *
 * `post`/`postAt` are thread-safe; everything else is called on the strand.
 */
class Strand {
public:
    /** A strand on a virtual clock that only `advanceTo`/`runUntil` move (tests, conformance). */
    Strand();
    /** A strand on `clock` that `run` drives in real time. */
    explicit Strand(const IClock& clock);
    Strand(const Strand&) = delete;
    Strand& operator=(const Strand&) = delete;

    int64_t nowMs() const;

    /** Runs `fn` at the current instant, after what is already due now. */
    TimerId post(std::function<void()> fn);
    /** Runs `fn` at `atMs` (never before the current instant). */
    TimerId postAt(int64_t atMs, std::function<void()> fn);
    /** The callback never runs (no-op if it already ran). */
    void cancel(TimerId id);

    /** Virtual clock: runs every event due up to and including `untilMs`; returns false if stopped. */
    bool runUntil(int64_t untilMs);
    /** Real clock: runs events as they become due until `stop`. */
    void run();
    void stop();
    bool stopped() const;

    /** Number of events run so far. */
    uint64_t events() const;

private:
    struct Event {
        int64_t at;
        TimerId seq;
        std::function<void()> fn;
    };
    struct Later {
        bool operator()(const Event& a, const Event& b) const {
            return a.at > b.at || (a.at == b.at && a.seq > b.seq);
        }
    };
    bool popDue(int64_t limit, Event& out);

    const IClock* m_clock;
    int64_t m_virtualNow = 0;
    mutable std::mutex m_mutex;
    std::condition_variable m_wake;
    std::vector<Event> m_heap;
    std::set<TimerId> m_cancelled;
    TimerId m_nextSeq = 0;
    uint64_t m_events = 0;
    bool m_stopped = false;
};

} // namespace simvehicleapp::rt

#endif // SIMVEHICLEAPP_RT_STRAND_HPP

// Copyright (c) 2026 SimVehicleApp contributors
// SPDX-License-Identifier: Apache-2.0

#include "simvehicleapp/rt/Strand.hpp"

#include <algorithm>
#include <chrono>

namespace simvehicleapp::rt {

namespace {
int64_t steadyMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}
} // namespace

SteadyClock::SteadyClock()
    : m_origin(steadyMs()) {}

int64_t SteadyClock::nowMs() const { return steadyMs() - m_origin; }

int64_t epochMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

Strand::Strand()
    : m_clock(nullptr) {}

Strand::Strand(const IClock& clock)
    : m_clock(&clock) {}

int64_t Strand::nowMs() const {
    if (m_clock != nullptr) {
        return m_clock->nowMs();
    }
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_virtualNow;
}

TimerId Strand::post(std::function<void()> fn) { return postAt(nowMs(), std::move(fn)); }

TimerId Strand::postAt(int64_t atMs, std::function<void()> fn) {
    std::lock_guard<std::mutex> lock(m_mutex);
    const TimerId id = m_nextSeq++;
    m_heap.push_back(Event{atMs, id, std::move(fn)});
    std::push_heap(m_heap.begin(), m_heap.end(), Later{});
    m_wake.notify_one();
    return id;
}

void Strand::cancel(TimerId id) {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_cancelled.insert(id);
}

bool Strand::popDue(int64_t limit, Event& out) {
    std::lock_guard<std::mutex> lock(m_mutex);
    while (!m_heap.empty() && !m_stopped) {
        if (m_heap.front().at > limit) {
            return false;
        }
        std::pop_heap(m_heap.begin(), m_heap.end(), Later{});
        Event e = std::move(m_heap.back());
        m_heap.pop_back();
        if (m_cancelled.erase(e.seq) > 0) {
            continue;
        }
        if (m_clock == nullptr && e.at > m_virtualNow) {
            m_virtualNow = e.at;
        }
        ++m_events;
        out = std::move(e);
        return true;
    }
    return false;
}

bool Strand::runUntil(int64_t untilMs) {
    Event e;
    while (popDue(untilMs, e)) {
        e.fn();
    }
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_stopped && m_clock == nullptr && m_virtualNow < untilMs) {
        m_virtualNow = untilMs;
    }
    return !m_stopped;
}

void Strand::run() {
    for (;;) {
        Event e;
        if (popDue(nowMs(), e)) {
            e.fn();
            continue;
        }
        std::unique_lock<std::mutex> lock(m_mutex);
        if (m_stopped) {
            return;
        }
        if (m_heap.empty()) {
            m_wake.wait(lock);
        } else {
            const int64_t due = m_heap.front().at - (m_clock != nullptr ? m_clock->nowMs() : m_virtualNow);
            if (due > 0) {
                m_wake.wait_for(lock, std::chrono::milliseconds(due));
            }
        }
    }
}

void Strand::stop() {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_stopped = true;
    m_wake.notify_all();
}

bool Strand::stopped() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_stopped;
}

uint64_t Strand::events() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_events;
}

} // namespace simvehicleapp::rt

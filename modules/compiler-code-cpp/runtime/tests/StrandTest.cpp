// Copyright (c) 2026 SimVehicleApp contributors
// SPDX-License-Identifier: Apache-2.0

#include "simvehicleapp/rt/Strand.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <thread>

using namespace simvehicleapp::rt;

TEST(StrandTest, runsByTimeThenPostOrder) {
    Strand s;
    std::vector<int> order;
    s.postAt(10, [&] { order.push_back(3); });
    s.postAt(0, [&] { order.push_back(1); });
    s.postAt(10, [&] { order.push_back(4); });
    s.post([&] {
        order.push_back(2);
        s.post([&] { order.push_back(5); }); // same instant, after what is already due
    });
    s.runUntil(10);
    EXPECT_EQ(order, (std::vector<int>{1, 2, 5, 3, 4}));
    EXPECT_EQ(s.nowMs(), 10);
}

TEST(StrandTest, cancelledEventsNeverRunAndTheClockStopsAtUntil) {
    Strand s;
    int ran = 0;
    const auto id = s.postAt(5, [&] { ++ran; });
    s.postAt(20, [&] { ran += 10; });
    s.cancel(id);
    s.runUntil(15);
    EXPECT_EQ(ran, 0);
    EXPECT_EQ(s.nowMs(), 15);
    s.runUntil(20);
    EXPECT_EQ(ran, 10);
}

TEST(StrandTest, stopEndsTheLoop) {
    Strand s;
    int ran = 0;
    s.postAt(1, [&] {
        ++ran;
        s.stop();
    });
    s.postAt(2, [&] { ++ran; });
    EXPECT_FALSE(s.runUntil(10));
    EXPECT_EQ(ran, 1);
}

TEST(StrandTest, realClockRunsPostsFromOtherThreads) {
    SteadyClock clock;
    Strand s(clock);
    std::atomic<int> count{0};
    std::thread loop([&] { s.run(); });
    std::vector<std::thread> producers;
    for (int i = 0; i < 4; ++i) {
        producers.emplace_back([&] {
            for (int j = 0; j < 250; ++j) {
                s.post([&] { ++count; });
            }
        });
    }
    for (auto& p : producers) {
        p.join();
    }
    s.post([&] { s.stop(); });
    loop.join();
    EXPECT_EQ(count.load(), 1000);
}

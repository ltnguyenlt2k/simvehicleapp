// Copyright (c) 2026 SimVehicleApp contributors
// SPDX-License-Identifier: Apache-2.0

#include "simvehicleapp/rt/Value.hpp"

#include <gtest/gtest.h>

#include <cmath>

using namespace simvehicleapp::rt;

// Expected strings come from the reference implementation (simulator values.ts / JavaScript).

TEST(ValueTest, formatsDoublesLikeJavaScript) {
    const std::vector<std::pair<double, std::string>> cases = {
        {0.0, "0"},
        {-0.0, "0"},
        {1.0, "1"},
        {-1.0, "-1"},
        {0.10000000000000001, "0.1"},
        {0.30000000000000004, "0.30000000000000004"},
        {0.33333333333333331, "0.3333333333333333"},
        {100.0, "100"},
        {1.0000000000000000e+21, "1e+21"},
        {1.0000000000000000e+20, "100000000000000000000"},
        {1.2345678901234568e+20, "123456789012345680000"},
        {9.9999999999999995e-7, "0.000001"},
        {9.9999999999999995e-8, "1e-7"},
        {1.4999999999999999e-7, "1.5e-7"},
        {9007199254740992.0, "9007199254740992"},
        {-1.1529215046068470e+18, "-1152921504606847000"},
        {4.9406564584124654e-324, "5e-324"},
        {1.7976931348623157e+308, "1.7976931348623157e+308"},
        {123.456, "123.456"},
        {0.000001234, "0.000001234"},
        {std::nan(""), "NaN"},
        {INFINITY, "Infinity"},
        {-INFINITY, "-Infinity"},
        {4.3499999999999996, "4.35"},
    };
    for (const auto& [x, want] : cases) {
        EXPECT_EQ(formatDouble(x), want) << x;
    }
}

TEST(ValueTest, formatsFloatsWithTheShortestBinary32RoundTrip) {
    const std::vector<std::pair<float, std::string>> cases = {
        {0.10000000149011612f, "0.1"},
        {120.5f, "120.5"},
        {0.33333334326744080f, "0.33333334"},
        {16777216.0f, "16777216"},
        {3.4028234663852886e+38f, "3.4028235e+38"},
        {1.4012984643248171e-45f, "1e-45"},
        {0.30000001192092896f, "0.3"},
        {10000000000.0f, "10000000000"},
        {2.5f, "2.5"},
        {100.25f, "100.25"},
        {1.0000000116860974e-7f, "1e-7"},
        {65.400001525878906f, "65.4"},
        {-0.10000000149011612f, "-0.1"},
        {0.0f, "0"},
        {33.333332061767578f, "33.333332"},
    };
    for (const auto& [x, want] : cases) {
        EXPECT_EQ(formatFloat(x), want) << x;
    }
}

TEST(ValueTest, castRoundsHalfAwayFromZeroAndClamps) {
    EXPECT_EQ(castValue(Value(2.5), "uint8", "double").dump(), "3");
    EXPECT_EQ(castValue(Value(-2.5), "int8", "double").dump(), "-3");
    EXPECT_EQ(castValue(Value(300.39999999999998), "uint8", "double").dump(), "255");
    EXPECT_EQ(castValue(Value(-1.0), "uint8", "double").dump(), "0");
    EXPECT_EQ(castValue(Value(1e30), "int64", "double").dump(), "9223372036854775807");
    EXPECT_EQ(castValue(Value(-1e30), "int64", "double").dump(), "-9223372036854775808");
    EXPECT_EQ(castValue(Value(1e30), "uint64", "double").dump(), "18446744073709551615");
    EXPECT_EQ(castValue(Value(0.49999999999999994), "int32", "double").dump(), "0");
    EXPECT_EQ(castValue(Value(-0.5), "int16", "double").dump(), "-1");
    EXPECT_EQ(castValue(Value(2147483647.5), "int32", "double").dump(), "2147483647");
    EXPECT_EQ(castValue(Value(9.3e18), "int64", "double").dump(), "9223372036854775807");
    EXPECT_EQ(castValue(Value(1.8e19), "uint64", "double").dump(), "18000000000000000000");
    EXPECT_EQ(castValue(Value(std::nan("")), "int32", "double").dump(), "0");
    EXPECT_EQ(castValue(Value(0.10000000149011612), "string", "float"), Value("0.1"));
    EXPECT_EQ(castValue(Value(0.10000000149011612), "string", "double"), Value("0.10000000149011612"));
    // the same rules on native values (generated code)
    EXPECT_EQ(as<uint8_t>(2.5), 3);
    EXPECT_EQ(as<int8_t>(-2.5), -3);
    EXPECT_EQ(as<uint8_t>(300.4), 255);
    EXPECT_EQ(as<int64_t>(1e30), INT64_MAX);
    EXPECT_EQ(as<uint64_t>(1.8e19), 18000000000000000000ULL);
    EXPECT_EQ(as<int32_t>(std::nan("")), 0);
    EXPECT_EQ(as<uint8_t>(int64_t{-5}), 0);
    EXPECT_EQ(as<int8_t>(uint64_t{300}), 127);
    EXPECT_EQ(as<std::string>(0.1f), "0.1");
    EXPECT_EQ(as<float>(0.1), 0.1f);
}

TEST(ValueTest, stringifiesLikeJsonStringify) {
    // JSON.parse('{"b":1,"2":2,"a":[1.0,2.5,"x\u0001\n"],"10":null,"01":3}') ⇒ JSON.stringify
    Value v = Value::parse(R"({"b":1,"2":2,"a":[1.0,2.5,"x\u0001\n"],"10":null,"01":3})");
    EXPECT_EQ(stringify(v), R"({"2":2,"10":null,"b":1,"a":[1,2.5,"x\u0001\n"],"01":3})");
    EXPECT_EQ(jsonString("say \"hi\"\n"), R"("say \"hi\"\n")");
    EXPECT_EQ(jsonString("Ünïcode ✓"), "\"Ünïcode ✓\"");
}

TEST(ValueTest, comparesIntegersExactlyAndMixedAsDoubles) {
    EXPECT_TRUE(lt(int64_t{-1}, uint64_t{0}));
    EXPECT_TRUE(gt(uint64_t{18446744073709551615ULL}, int64_t{9223372036854775807LL}));
    EXPECT_TRUE(eq(uint8_t{120}, 120.0));
    EXPECT_TRUE(gt(130.0f, int64_t{120}));
    EXPECT_FALSE(eq(std::nan(""), std::nan("")));
    EXPECT_FALSE(lt(std::nan(""), 1.0));
    EXPECT_FALSE(ge(std::nan(""), 1.0));
}

TEST(ValueTest, scenarioValuesConvertToTheirType) {
    EXPECT_EQ(fromJson(Value("18446744073709551615"), "uint64").get<uint64_t>(), UINT64_MAX);
    EXPECT_EQ(fromJson(Value(12.9), "uint8").dump(), "12");
    EXPECT_EQ(fromJson(Value(0.1), "float").get<double>(), static_cast<double>(0.1f));
    EXPECT_EQ(toJson(Value(int64_t{5}), "int64"), Value("5"));
    EXPECT_EQ(toJson(Value(int64_t{5}), "uint8"), Value(5));
    EXPECT_EQ(formatValue(Value(0.10000000149011612), "float"), "0.1");
}

TEST(ValueTest, arrayHelpers) {
    const std::vector<int32_t> a{1, 2, 3};
    EXPECT_EQ(arrayIndex(a, 2), 3);
    EXPECT_EQ(arrayAt(a, 7, 0), 0);
    EXPECT_TRUE(arrayContains(a, 2.0));
    try {
        arrayIndex(a, 3);
        FAIL();
    } catch (const EvalError& e) {
        EXPECT_EQ(e.reason(), "array_index_out_of_range");
        EXPECT_STREQ(e.what(), "index 3 is outside 0…2");
    }
}

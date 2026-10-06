// Copyright (c) 2026 SimVehicleApp contributors
// SPDX-License-Identifier: Apache-2.0

#ifndef SIMVEHICLEAPP_RT_VALUE_HPP
#define SIMVEHICLEAPP_RT_VALUE_HPP

#include <nlohmann/json.hpp>

#include <cmath>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <vector>

/**
 * Values of the runtime (IR_SPEC "Semantics every backend implements", ADR-0015 Notes §7).
 *
 * Generated code works with native C++ types (bool, intN_t, float, double, std::string,
 * std::vector<T>); `Value` is the dynamic form used for signal caches, run outputs and trace data.
 * Integers keep their exact int64/uint64 value; `float` values are stored as the double of the float.
 */
namespace simvehicleapp::rt {

using Value = nlohmann::ordered_json;

/** Error of an expression or an I/O step; takes the step's `error` branch (ADR-0012 §6). */
class EvalError : public std::runtime_error {
public:
    EvalError(std::string reason, const std::string& message)
        : std::runtime_error(message)
        , m_reason(std::move(reason)) {}
    const std::string& reason() const { return m_reason; }

private:
    std::string m_reason;
};

/** Number formatted like ECMAScript `Number::toString` (shortest round trip). */
std::string formatDouble(double x);
/** Shortest decimal that round-trips `x` as binary32 (IR_SPEC "Formatting in templates"). */
std::string formatFloat(float x);
/** JSON text of `v` like `JSON.stringify` (numbers as `formatDouble`, no spaces). */
std::string stringify(const Value& v);
/** JSON string literal of `s` (quotes and escapes), op `json.string`. */
std::string jsonString(const std::string& s);
/** Round half away from zero (ADR-0014 Notes §11). */
double roundHalfAway(double x);

/** Dynamic value ⇒ JSON for writes and trace: int64/uint64 as decimal strings (ADR-0018 §7). */
Value toJson(const Value& v, const std::string& type);
/** JSON/scenario value ⇒ the dynamic form of `type`. */
Value fromJson(const Value& v, const std::string& type);
/** Template formatting of a dynamic value of static type `type`. */
std::string formatValue(const Value& v, const std::string& type);
/** Numeric value (`Number(v)`): booleans 0/1, null 0. */
double toNumber(const Value& v);
/** `type.cast` of a dynamic value to `to`; `from` is the static type of the value. */
Value castValue(const Value& v, const std::string& to, const std::string& from);

/** A string literal as `std::string` with its full length — embedded NULs included (user text from the IR). */
template <std::size_t N> std::string str(const char (&s)[N]) { return std::string(s, N - 1); }

/** Template formatting of native values. */
inline std::string format(bool v) { return v ? "true" : "false"; }
inline std::string format(float v) { return formatFloat(v); }
inline std::string format(double v) { return formatDouble(v); }
inline std::string format(const std::string& v) { return v; }
inline std::string format(const char* v) { return v; }
template <class T, std::enable_if_t<std::is_integral_v<T> && !std::is_same_v<T, bool>, int> = 0>
std::string format(T v) {
    return std::to_string(v);
}
template <class T> std::string format(const std::vector<T>& v);

/** Native value ⇒ dynamic value. */
inline Value toValue(bool v) { return Value(v); }
inline Value toValue(float v) { return Value(static_cast<double>(v)); }
inline Value toValue(double v) { return Value(v); }
inline Value toValue(const std::string& v) { return Value(v); }
template <class T, std::enable_if_t<std::is_integral_v<T> && !std::is_same_v<T, bool>, int> = 0>
Value toValue(T v) {
    if constexpr (std::is_signed_v<T>) {
        return Value(static_cast<int64_t>(v));
    } else {
        return Value(static_cast<uint64_t>(v));
    }
}
template <class T> Value toValue(const std::vector<T>& v) {
    Value out = Value::array();
    for (const auto& x : v) {
        out.push_back(toValue(x));
    }
    return out;
}
inline Value toValue(const Value& v) { return v; }

/** Dynamic value ⇒ native value (the compiler checked the type; null is a missing value). */
template <class T> struct From;
template <> struct From<bool> {
    static bool get(const Value& v) { return v.get<bool>(); }
};
template <> struct From<float> {
    static float get(const Value& v) { return static_cast<float>(v.get<double>()); }
};
template <> struct From<double> {
    static double get(const Value& v) { return v.get<double>(); }
};
template <> struct From<std::string> {
    static std::string get(const Value& v) { return v.get<std::string>(); }
};
template <> struct From<Value> {
    static Value get(const Value& v) { return v; }
};
template <class T> struct From {
    static_assert(std::is_integral_v<T>, "unsupported value type");
    static T get(const Value& v) {
        if (v.is_number_unsigned()) {
            return static_cast<T>(v.get<uint64_t>());
        }
        if (v.is_number_integer()) {
            return static_cast<T>(v.get<int64_t>());
        }
        return static_cast<T>(v.get<double>());
    }
};
template <class T> struct From<std::vector<T>> {
    static std::vector<T> get(const Value& v) {
        std::vector<T> out;
        out.reserve(v.size());
        for (const auto& x : v) {
            out.push_back(From<T>::get(x));
        }
        return out;
    }
};

template <class T> std::string format(const std::vector<T>& v) { return stringify(toValue(v)); }

/** Integer bounds as doubles/ints for `cast`. */
template <class T> T castInt(double x) {
    static_assert(std::is_integral_v<T>);
    if (std::isnan(x)) {
        return 0;
    }
    const double r = roundHalfAway(x);
    constexpr double lo = static_cast<double>(std::numeric_limits<T>::min());
    // 2^bits: the first value above max (max itself may not be a double).
    constexpr double hiExclusive =
        std::is_signed_v<T> ? -static_cast<double>(std::numeric_limits<T>::min())
                            : 2.0 * (static_cast<double>(std::numeric_limits<T>::max() / 2) + 1.0);
    if (r < lo) {
        return std::numeric_limits<T>::min();
    }
    if (r >= hiExclusive) {
        return std::numeric_limits<T>::max();
    }
    return static_cast<T>(r);
}

/** `type.cast` / implicit conversion of native values (IR_SPEC Operators `type.cast`). */
template <class To, class From_> To as(const From_& v) {
    if constexpr (std::is_same_v<To, From_>) {
        return v;
    } else if constexpr (std::is_same_v<To, std::string>) {
        return format(v);
    } else if constexpr (std::is_same_v<To, bool>) {
        if constexpr (std::is_same_v<From_, std::string>) {
            return !v.empty();
        } else {
            return v != 0 && !(std::is_floating_point_v<From_> && std::isnan(static_cast<double>(v)));
        }
    } else if constexpr (std::is_floating_point_v<To>) {
        return static_cast<To>(static_cast<double>(v));
    } else if constexpr (std::is_floating_point_v<From_>) {
        return castInt<To>(static_cast<double>(v));
    } else if constexpr (std::is_same_v<From_, bool>) {
        return static_cast<To>(v ? 1 : 0);
    } else {
        // integer ⇒ integer: clamp
        if constexpr (std::is_signed_v<From_>) {
            const auto x = static_cast<int64_t>(v);
            if constexpr (std::is_signed_v<To>) {
                if (x < static_cast<int64_t>(std::numeric_limits<To>::min())) {
                    return std::numeric_limits<To>::min();
                }
                if (x > static_cast<int64_t>(std::numeric_limits<To>::max())) {
                    return std::numeric_limits<To>::max();
                }
                return static_cast<To>(x);
            } else {
                if (x < 0) {
                    return 0;
                }
                if (static_cast<uint64_t>(x) > static_cast<uint64_t>(std::numeric_limits<To>::max())) {
                    return std::numeric_limits<To>::max();
                }
                return static_cast<To>(x);
            }
        } else {
            const auto x = static_cast<uint64_t>(v);
            if (x > static_cast<uint64_t>(std::numeric_limits<To>::max())) {
                return std::numeric_limits<To>::max();
            }
            return static_cast<To>(x);
        }
    }
}

/** Comparisons: integers exactly (signed vs unsigned too), otherwise as doubles. */
template <class L, class R> int compareNum(L l, R r) {
    if constexpr (std::is_integral_v<L> && std::is_integral_v<R>) {
        if constexpr (std::is_signed_v<L> && !std::is_signed_v<R>) {
            if (l < 0) {
                return -1;
            }
            const auto a = static_cast<uint64_t>(l);
            return a < r ? -1 : (a > r ? 1 : 0);
        } else if constexpr (!std::is_signed_v<L> && std::is_signed_v<R>) {
            return -compareNum(r, l);
        } else {
            return l < r ? -1 : (l > r ? 1 : 0);
        }
    } else {
        const double a = static_cast<double>(l);
        const double b = static_cast<double>(r);
        if (a < b) {
            return -1;
        }
        if (a > b) {
            return 1;
        }
        return a == b ? 0 : 2; // 2: unordered (NaN)
    }
}
template <class L, class R> bool eq(const L& l, const R& r) {
    if constexpr (std::is_arithmetic_v<L> && std::is_arithmetic_v<R>) {
        return compareNum(l, r) == 0;
    } else {
        return l == r;
    }
}
template <class L, class R> bool lt(L l, R r) { return compareNum(l, r) == -1; }
template <class L, class R> bool le(L l, R r) {
    const int c = compareNum(l, r);
    return c == -1 || c == 0;
}
template <class L, class R> bool gt(L l, R r) { return compareNum(l, r) == 1; }
template <class L, class R> bool ge(L l, R r) {
    const int c = compareNum(l, r);
    return c == 1 || c == 0;
}

/** Template formatting of a double whose static type is `float` (simulator `formatFloat32` on any number). */
std::string formatAsFloat(double x);
/** Integer `abs` (the compiler proved the result fits int64). */
inline int64_t absInt(int64_t v) { return v < 0 ? -v : v; }
/** Integer `clamp`: below `lo` ⇒ `lo`, else above `hi` ⇒ `hi` (simulator order when lo > hi). */
inline int64_t clampInt(int64_t v, int64_t lo, int64_t hi) { return v < lo ? lo : (v > hi ? hi : v); }

/** `min`/`max`/`clamp` on doubles like ECMAScript `Math.min`/`Math.max` (NaN propagates). */
double jsMin(std::initializer_list<double> xs);
double jsMax(std::initializer_list<double> xs);
/** `round(v, digits)`: half away from zero at `digits` decimals. */
double roundTo(double v, double digits);
/** `scale(x, inMin, inMax, outMin, outMax)`. */
inline double scale(double v, double a, double b, double c, double d) {
    return c + ((v - a) * (d - c)) / (b - a);
}

/** Element `i` of `arr` (`array.at` with a default / `array.index`, ADR-0018 §4). */
template <class T, class I> T arrayIndex(const std::vector<T>& arr, I index) {
    const auto i = static_cast<int64_t>(index);
    if (i >= 0 && static_cast<uint64_t>(i) < arr.size()) {
        return arr[static_cast<size_t>(i)];
    }
    throw EvalError("array_index_out_of_range", "index " + std::to_string(i) + " is outside 0…" +
                                                    std::to_string(static_cast<int64_t>(arr.size()) - 1));
}
template <class T, class I> T arrayAt(const std::vector<T>& arr, I index, const T& fallback) {
    const auto i = static_cast<int64_t>(index);
    if (i >= 0 && static_cast<uint64_t>(i) < arr.size()) {
        return arr[static_cast<size_t>(i)];
    }
    return fallback;
}
template <class T, class U> bool arrayContains(const std::vector<T>& arr, const U& item) {
    for (const auto& x : arr) {
        if (eq(x, item)) {
            return true;
        }
    }
    return false;
}

} // namespace simvehicleapp::rt

#endif // SIMVEHICLEAPP_RT_VALUE_HPP

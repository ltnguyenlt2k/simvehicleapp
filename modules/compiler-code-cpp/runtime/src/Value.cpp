// Copyright (c) 2026 SimVehicleApp contributors
// SPDX-License-Identifier: Apache-2.0

#include "simvehicleapp/rt/Value.hpp"

#include <algorithm>
#include <charconv>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace simvehicleapp::rt {

namespace {

bool isIntLike(const std::string& t) {
    return t == "int8" || t == "int16" || t == "int32" || t == "int64" || t == "uint8" ||
           t == "uint16" || t == "uint32" || t == "uint64" || t == "duration" || t == "timestamp";
}

bool isIntegerType(const std::string& t) {
    return t == "int8" || t == "int16" || t == "int32" || t == "int64" || t == "uint8" ||
           t == "uint16" || t == "uint32" || t == "uint64";
}

bool isUnsigned(const std::string& t) {
    return t == "uint8" || t == "uint16" || t == "uint32" || t == "uint64";
}

/** Bounds of an integer type as int64 (min) / uint64 (max). */
void integerBounds(const std::string& t, int64_t& lo, uint64_t& hi) {
    if (t == "int8") {
        lo = INT8_MIN, hi = INT8_MAX;
    } else if (t == "int16") {
        lo = INT16_MIN, hi = INT16_MAX;
    } else if (t == "int32") {
        lo = INT32_MIN, hi = INT32_MAX;
    } else if (t == "int64") {
        lo = INT64_MIN, hi = INT64_MAX;
    } else if (t == "uint8") {
        lo = 0, hi = UINT8_MAX;
    } else if (t == "uint16") {
        lo = 0, hi = UINT16_MAX;
    } else if (t == "uint32") {
        lo = 0, hi = UINT32_MAX;
    } else {
        lo = 0, hi = UINT64_MAX;
    }
}

/** Integer value of type `t` clamped to its range. */
Value integerValue(bool negative, uint64_t magnitude, const std::string& t) {
    int64_t lo = 0;
    uint64_t hi = 0;
    integerBounds(t, lo, hi);
    if (negative) {
        // -magnitude < lo ⇔ magnitude > -lo
        const uint64_t minMag = lo < 0 ? static_cast<uint64_t>(-(lo + 1)) + 1 : 0;
        if (magnitude > minMag) {
            return lo < 0 ? Value(lo) : Value(static_cast<uint64_t>(0));
        }
        if (magnitude == 0) {
            return isUnsigned(t) ? Value(static_cast<uint64_t>(0)) : Value(static_cast<int64_t>(0));
        }
        return Value(static_cast<int64_t>(-static_cast<int64_t>(magnitude - 1) - 1));
    }
    if (magnitude > hi) {
        magnitude = hi;
    }
    return isUnsigned(t) ? Value(magnitude) : Value(static_cast<int64_t>(magnitude));
}

/** Digits and decimal exponent of the shortest round trip (`to_chars` scientific). */
void shortest(double x, std::string& digits, int& exp10) {
    char buf[64];
    auto res = std::to_chars(buf, buf + sizeof buf, x, std::chars_format::scientific);
    std::string s(buf, res.ptr);
    const auto e = s.find('e');
    digits.clear();
    for (size_t i = 0; i < e; ++i) {
        if (s[i] != '.') {
            digits.push_back(s[i]);
        }
    }
    exp10 = std::atoi(s.c_str() + e + 1);
}

std::string escapeJson(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 2);
    out.push_back('"');
    for (const char ch : s) {
        const auto c = static_cast<unsigned char>(ch);
        switch (c) {
        case '"':
            out += "\\\"";
            break;
        case '\\':
            out += "\\\\";
            break;
        case '\b':
            out += "\\b";
            break;
        case '\f':
            out += "\\f";
            break;
        case '\n':
            out += "\\n";
            break;
        case '\r':
            out += "\\r";
            break;
        case '\t':
            out += "\\t";
            break;
        default:
            if (c < 0x20) {
                char u[8];
                std::snprintf(u, sizeof u, "\\u%04x", c);
                out += u;
            } else {
                out.push_back(ch);
            }
        }
    }
    out.push_back('"');
    return out;
}

/** ECMAScript array index: canonical decimal below 2^32 - 1 (such keys come first, ascending). */
bool arrayIndexKey(const std::string& k, uint64_t& n) {
    if (k.empty() || k.size() > 10 || (k.size() > 1 && k[0] == '0')) {
        return false;
    }
    n = 0;
    for (const char c : k) {
        if (c < '0' || c > '9') {
            return false;
        }
        n = n * 10 + static_cast<uint64_t>(c - '0');
    }
    return n < 4294967295ULL;
}

void stringifyTo(const Value& v, std::string& out) {
    switch (v.type()) {
    case Value::value_t::null:
    case Value::value_t::discarded:
        out += "null";
        return;
    case Value::value_t::boolean:
        out += v.get<bool>() ? "true" : "false";
        return;
    case Value::value_t::number_integer:
        out += std::to_string(v.get<int64_t>());
        return;
    case Value::value_t::number_unsigned:
        out += std::to_string(v.get<uint64_t>());
        return;
    case Value::value_t::number_float: {
        const double d = v.get<double>();
        out += std::isfinite(d) ? formatDouble(d) : "null";
        return;
    }
    case Value::value_t::string:
        out += escapeJson(v.get_ref<const std::string&>());
        return;
    case Value::value_t::array: {
        out.push_back('[');
        bool first = true;
        for (const auto& x : v) {
            if (!first) {
                out.push_back(',');
            }
            first = false;
            stringifyTo(x, out);
        }
        out.push_back(']');
        return;
    }
    case Value::value_t::object: {
        std::vector<std::pair<uint64_t, const std::string*>> indexKeys;
        std::vector<const std::string*> otherKeys;
        for (auto it = v.begin(); it != v.end(); ++it) {
            uint64_t n = 0;
            if (arrayIndexKey(it.key(), n)) {
                indexKeys.emplace_back(n, &it.key());
            } else {
                otherKeys.push_back(&it.key());
            }
        }
        std::sort(indexKeys.begin(), indexKeys.end());
        out.push_back('{');
        bool first = true;
        auto member = [&](const std::string& k) {
            if (!first) {
                out.push_back(',');
            }
            first = false;
            out += escapeJson(k);
            out.push_back(':');
            stringifyTo(v.at(k), out);
        };
        for (const auto& [n, k] : indexKeys) {
            member(*k);
        }
        for (const auto* k : otherKeys) {
            member(*k);
        }
        out.push_back('}');
        return;
    }
    case Value::value_t::binary:
        out += "null";
        return;
    }
}

double jsStringToNumber(const std::string& raw) {
    const auto b = raw.find_first_not_of(" \t\n\v\f\r");
    if (b == std::string::npos) {
        return 0.0;
    }
    const auto e = raw.find_last_not_of(" \t\n\v\f\r");
    const std::string s = raw.substr(b, e - b + 1);
    if (s == "Infinity" || s == "+Infinity") {
        return std::numeric_limits<double>::infinity();
    }
    if (s == "-Infinity") {
        return -std::numeric_limits<double>::infinity();
    }
    if (s.size() > 2 && s[0] == '0' && (s[1] == 'x' || s[1] == 'X' || s[1] == 'o' || s[1] == 'O' ||
                                        s[1] == 'b' || s[1] == 'B')) {
        const int base = (s[1] == 'x' || s[1] == 'X') ? 16 : (s[1] == 'o' || s[1] == 'O') ? 8 : 2;
        double n = 0;
        for (size_t i = 2; i < s.size(); ++i) {
            const char c = static_cast<char>(std::tolower(static_cast<unsigned char>(s[i])));
            const int d = (c >= '0' && c <= '9') ? c - '0' : (c >= 'a' && c <= 'f') ? c - 'a' + 10 : 99;
            if (d >= base) {
                return std::numeric_limits<double>::quiet_NaN();
            }
            n = n * base + d;
        }
        return n;
    }
    // StrDecimalLiteral: [+-] digits [. digits] [e[+-]digits] — no "inf"/"nan"/hex floats.
    for (const char c : s) {
        if (!(std::isdigit(static_cast<unsigned char>(c)) || c == '.' || c == 'e' || c == 'E' ||
              c == '+' || c == '-')) {
            return std::numeric_limits<double>::quiet_NaN();
        }
    }
    char* end = nullptr;
    const double d = std::strtod(s.c_str(), &end);
    if (end != s.c_str() + s.size() || s == "." || s == "+" || s == "-") {
        return std::numeric_limits<double>::quiet_NaN();
    }
    return d;
}

} // namespace

std::string formatDouble(double x) {
    if (std::isnan(x)) {
        return "NaN";
    }
    if (x == 0) {
        return "0";
    }
    if (x < 0) {
        return "-" + formatDouble(-x);
    }
    if (std::isinf(x)) {
        return "Infinity";
    }
    std::string s;
    int e = 0;
    shortest(x, s, e);
    const int k = static_cast<int>(s.size());
    const int n = e + 1;
    if (k <= n && n <= 21) {
        return s + std::string(static_cast<size_t>(n - k), '0');
    }
    if (0 < n && n <= 21) {
        return s.substr(0, static_cast<size_t>(n)) + "." + s.substr(static_cast<size_t>(n));
    }
    if (-6 < n && n <= 0) {
        return "0." + std::string(static_cast<size_t>(-n), '0') + s;
    }
    const std::string ex = (n - 1 >= 0 ? "+" : "-") + std::to_string(std::abs(n - 1));
    if (k == 1) {
        return s + "e" + ex;
    }
    return s.substr(0, 1) + "." + s.substr(1) + "e" + ex;
}

std::string formatFloat(float f) {
    const double x = static_cast<double>(f);
    if (!std::isfinite(x) || x == 0) {
        return formatDouble(x);
    }
    // Exact decimal expansion of the float (at most ~105 significant digits), then
    // Number.prototype.toPrecision(p) rounding (ties away from zero) for p = 1…9.
    const double ax = std::fabs(x);
    char buf[160];
    std::snprintf(buf, sizeof buf, "%.120e", ax);
    const char* e = std::strchr(buf, 'e');
    std::string digits;
    for (const char* p = buf; p < e; ++p) {
        if (*p != '.') {
            digits.push_back(*p);
        }
    }
    const int exp10 = std::atoi(e + 1);
    for (int p = 1; p <= 9; ++p) {
        std::string d = digits.substr(0, static_cast<size_t>(p));
        int ex = exp10;
        if (digits[static_cast<size_t>(p)] >= '5') {
            int i = p - 1;
            while (i >= 0 && d[static_cast<size_t>(i)] == '9') {
                d[static_cast<size_t>(i)] = '0';
                --i;
            }
            if (i < 0) {
                d.insert(d.begin(), '1');
                d.pop_back();
                ++ex;
            } else {
                ++d[static_cast<size_t>(i)];
            }
        }
        const std::string text = d + "e" + std::to_string(ex - (p - 1));
        const double candidate = std::strtod(text.c_str(), nullptr);
        if (static_cast<float>(candidate) == std::fabs(f)) {
            return (x < 0 ? "-" : "") + formatDouble(candidate);
        }
    }
    return formatDouble(x);
}

std::string formatAsFloat(double x) {
    // Only a value that is exactly a binary32 number gets the float formatting.
    if (std::isfinite(x) && static_cast<double>(static_cast<float>(x)) == x) {
        return formatFloat(static_cast<float>(x));
    }
    return formatDouble(x);
}

std::string stringify(const Value& v) {
    std::string out;
    stringifyTo(v, out);
    return out;
}

std::string jsonString(const std::string& s) { return escapeJson(s); }

double roundHalfAway(double x) { return std::round(x); }

double roundTo(double v, double digits) {
    const double f = std::pow(10.0, digits);
    return roundHalfAway(v * f) / f;
}

double jsMin(std::initializer_list<double> xs) {
    double m = std::numeric_limits<double>::infinity();
    for (const double x : xs) {
        if (std::isnan(x)) {
            return x;
        }
        if (x < m || (x == 0 && m == 0 && std::signbit(x))) {
            m = x;
        }
    }
    return m;
}

double jsMax(std::initializer_list<double> xs) {
    double m = -std::numeric_limits<double>::infinity();
    for (const double x : xs) {
        if (std::isnan(x)) {
            return x;
        }
        if (x > m || (x == 0 && m == 0 && !std::signbit(x))) {
            m = x;
        }
    }
    return m;
}

double toNumber(const Value& v) {
    switch (v.type()) {
    case Value::value_t::null:
        return 0.0;
    case Value::value_t::boolean:
        return v.get<bool>() ? 1.0 : 0.0;
    case Value::value_t::number_integer:
        return static_cast<double>(v.get<int64_t>());
    case Value::value_t::number_unsigned:
        return static_cast<double>(v.get<uint64_t>());
    case Value::value_t::number_float:
        return v.get<double>();
    case Value::value_t::string:
        return jsStringToNumber(v.get_ref<const std::string&>());
    default:
        return std::numeric_limits<double>::quiet_NaN();
    }
}

Value toJson(const Value& v, const std::string& type) {
    if (v.is_array()) {
        const std::string elem =
            type.size() > 2 && type.compare(type.size() - 2, 2, "[]") == 0 ? type.substr(0, type.size() - 2) : "";
        Value out = Value::array();
        for (const auto& x : v) {
            out.push_back(toJson(x, elem));
        }
        return out;
    }
    if (v.is_number_integer() || v.is_number_unsigned()) {
        if (type == "int64" || type == "uint64") {
            return Value(v.is_number_unsigned() ? std::to_string(v.get<uint64_t>()) : std::to_string(v.get<int64_t>()));
        }
        constexpr int64_t safe = 9007199254740991LL;
        if (v.is_number_unsigned()) {
            const auto u = v.get<uint64_t>();
            return u <= static_cast<uint64_t>(safe) ? Value(u) : Value(std::to_string(u));
        }
        const auto i = v.get<int64_t>();
        return (i >= -safe && i <= safe) ? Value(i) : Value(std::to_string(i));
    }
    return v;
}

Value fromJson(const Value& v, const std::string& type) {
    if (v.is_null()) {
        return Value();
    }
    if (type.size() > 2 && type.compare(type.size() - 2, 2, "[]") == 0) {
        const std::string elem = type.substr(0, type.size() - 2);
        Value out = Value::array();
        for (const auto& x : v) {
            out.push_back(fromJson(x, elem));
        }
        return out;
    }
    if (isIntLike(type)) {
        const bool unsignedType = isUnsigned(type);
        if (v.is_number_integer() && !v.is_number_unsigned()) {
            const auto i = v.get<int64_t>();
            return unsignedType && i >= 0 ? Value(static_cast<uint64_t>(i)) : Value(i);
        }
        if (v.is_number_unsigned()) {
            const auto u = v.get<uint64_t>();
            return unsignedType || u > static_cast<uint64_t>(INT64_MAX) ? Value(u) : Value(static_cast<int64_t>(u));
        }
        if (v.is_string()) {
            const auto& s = v.get_ref<const std::string&>();
            if (!s.empty() && s[0] == '-') {
                return Value(static_cast<int64_t>(std::stoll(s)));
            }
            const auto u = std::stoull(s);
            return unsignedType || u > static_cast<uint64_t>(INT64_MAX) ? Value(u) : Value(static_cast<int64_t>(u));
        }
        const double d = std::trunc(toNumber(v));
        if (d >= 0 && (unsignedType || d >= 9223372036854775808.0)) {
            return d >= 18446744073709551616.0 ? Value(UINT64_MAX) : Value(static_cast<uint64_t>(d));
        }
        return Value(static_cast<int64_t>(d));
    }
    if (type == "float") {
        return Value(static_cast<double>(static_cast<float>(toNumber(v))));
    }
    if (type == "double") {
        return Value(toNumber(v));
    }
    if (type == "boolean") {
        return castValue(v, "boolean", "");
    }
    if (type == "string") {
        if (v.is_string()) {
            return v;
        }
        if (v.is_boolean()) {
            return Value(v.get<bool>() ? "true" : "false");
        }
        if (v.is_number()) {
            return Value(formatValue(v, ""));
        }
        return Value(v.is_array() ? "" : "[object Object]");
    }
    return v;
}

std::string formatValue(const Value& v, const std::string& type) {
    switch (v.type()) {
    case Value::value_t::null:
        return "";
    case Value::value_t::number_integer:
        return std::to_string(v.get<int64_t>());
    case Value::value_t::number_unsigned:
        return std::to_string(v.get<uint64_t>());
    case Value::value_t::number_float:
        return type == "float" ? formatFloat(static_cast<float>(v.get<double>())) : formatDouble(v.get<double>());
    case Value::value_t::boolean:
        return v.get<bool>() ? "true" : "false";
    case Value::value_t::string:
        return v.get<std::string>();
    default:
        return stringify(toJson(v, type));
    }
}

Value castValue(const Value& v, const std::string& to, const std::string& from) {
    if (isIntegerType(to)) {
        if (v.is_number_unsigned()) {
            return integerValue(false, v.get<uint64_t>(), to);
        }
        if (v.is_number_integer()) {
            const auto i = v.get<int64_t>();
            return integerValue(i < 0, i < 0 ? static_cast<uint64_t>(-(i + 1)) + 1 : static_cast<uint64_t>(i), to);
        }
        const double x = toNumber(v);
        if (std::isnan(x)) {
            return integerValue(false, 0, to);
        }
        if (std::isinf(x)) {
            return integerValue(x < 0, UINT64_MAX, to);
        }
        const double r = roundHalfAway(x);
        const double mag = std::fabs(r);
        const uint64_t m = mag >= 18446744073709551616.0 ? UINT64_MAX : static_cast<uint64_t>(mag);
        return integerValue(r < 0, m, to);
    }
    if (to == "float") {
        return Value(static_cast<double>(static_cast<float>(toNumber(v))));
    }
    if (to == "double") {
        return Value(toNumber(v));
    }
    if (to == "string") {
        return Value(formatValue(v, from));
    }
    if (to == "boolean") {
        switch (v.type()) {
        case Value::value_t::null:
            return Value(false);
        case Value::value_t::boolean:
            return v;
        case Value::value_t::number_integer:
        case Value::value_t::number_unsigned:
        case Value::value_t::number_float: {
            const double d = toNumber(v);
            return Value(d != 0 && !std::isnan(d));
        }
        case Value::value_t::string:
            return Value(!v.get_ref<const std::string&>().empty());
        default:
            return Value(true);
        }
    }
    return v;
}

} // namespace simvehicleapp::rt

"""Value semantics = the reference simulator's (values.ts): JS number formatting, rounding, casts, operators."""

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

from simvehicleapp_runtime import values as V  # noqa: E402
from simvehicleapp_runtime.values import EvalError  # noqa: E402


@pytest.mark.parametrize(
    "x, s",
    [
        (0.0, "0"),
        (-0.0, "0"),
        (1.0, "1"),
        (0.1, "0.1"),
        (1e21, "1e+21"),
        (1e-7, "1e-7"),
        (123456789012345680000.0, "123456789012345680000"),
        (0.000001, "0.000001"),
        (-1.5, "-1.5"),
        (math.inf, "Infinity"),
        (-math.inf, "-Infinity"),
        (math.nan, "NaN"),
        (5e-324, "5e-324"),
        (1.7976931348623157e308, "1.7976931348623157e+308"),
    ],
)
def test_js_number_to_string(x, s):
    assert V.js_num_str(x) == s


def test_float32_formatting_and_rounding():
    f = V.fround(0.1)
    assert f == 0.10000000149011612
    assert V.fmt(f, "float") == "0.1"
    assert V.fmt(f, "double") == "0.10000000149011612"
    assert V.fmt(1e40, "float") == "1e+40"  # not a binary32 value: printed as a double
    assert V.fround(1e40) == math.inf


def test_round_half_away_from_zero():
    assert V.round_half_away(0.5) == 1
    assert V.round_half_away(-0.5) == -1
    assert V.round_half_away(2.5) == 3
    assert V.round_half_away(0.49999999999999994) == 0
    assert V.round_(1.005, 2) == 1  # 1.005 * 100 = 100.49999999999999 like JS
    assert V.round_(2.345, 1) == 2.3


def test_cast_clamps_and_rounds():
    assert V.cast(300, "uint8") == 255
    assert V.cast(-1, "uint8") == 0
    assert V.cast(2.5, "int8") == 3
    assert V.cast(-2.5, "int8") == -3
    assert V.cast(math.nan, "int32") == 0
    assert V.cast(math.inf, "int16") == 32767
    assert V.cast(0.1, "string", "double") == "0.1"
    assert V.cast(V.fround(0.1), "string", "float") == "0.1"
    assert V.cast(0, "boolean") is False
    assert V.cast("x", "boolean") is True
    assert V.cast(2**70, "uint64") == 2**64 - 1


def test_arithmetic_follows_javascript():
    assert V.div(1, 0) == math.inf
    assert V.div(-1, 0) == -math.inf
    assert math.isnan(V.div(0, 0))
    assert math.isnan(V.mod(1, 0))
    assert V.mod(-7, 3) == -1  # fmod, sign of the dividend
    assert V.arith("+", 2**62, 2**62, "int64") == 2**63  # exact, the cast at the write clamps
    assert V.arith("*", 0.1, 3, "float") == V.fround(0.1 * 3)
    assert V.neg(5) == -5 and isinstance(V.neg(5), int)


def test_comparisons_and_logic():
    assert V.compare("<", 1, 1.5)
    assert V.compare("==", 2**53 + 1, 2**53 + 1)
    assert not V.compare("==", 2**53 + 1, 2**53)
    assert V.compare("==", "a", "a")
    assert not V.compare("<", "a", "b")  # only numbers are ordered
    assert not V.compare("==", True, 1)  # a boolean is not a number
    assert V.land(True, lambda: True) is True
    assert V.land(False, lambda: 1 / 0) is False  # lazy like the simulator
    assert V.lor(True, lambda: 1 / 0) is True
    assert V.lnot(None) is True


def test_min_max_clamp_scale():
    assert math.isnan(V.js_min([1, math.nan]))
    assert V.min_max("max", [1, 7, 3], "int32") == 7
    assert V.clamp(15, 0, 10, "int32") == 10
    assert V.clamp(0.5, 0, 0.25, "double") == 0.25
    assert V.scale(5, 0, 10, 0, 100) == 50
    assert V.scale(5, 1, 1, 0, 100) == math.inf


def test_arrays():
    assert V.array_len([1, 2, 3]) == 3
    assert V.array_contains([1, 2], 2.0)
    assert V.array_at([1, 2], 1) == 2
    assert V.array_at([1, 2], 5, lambda: 9) == 9
    with pytest.raises(EvalError) as e:
        V.array_at([1, 2], 5)
    assert e.value.reason == "array_index_out_of_range"


def test_templates_and_json():
    assert V.template("a", V.fmt(1.0, "double"), V.fmt(True, "boolean"), V.fmt(None, "string")) == "a1true"
    assert V.fmt([1, 2], "uint8[]") == "[1,2]"
    assert V.fmt({"a": 1.5}, "json") == '{"a":1.5}'
    assert V.json_string('say "hi"\n', "string") == '"say \\"hi\\"\\n"'
    assert V.to_json(2**63 - 1, "int64") == "9223372036854775807"
    assert V.to_json(120.0) == 120 and isinstance(V.to_json(120.0), int)
    assert V.from_json("42", "int64") == 42
    assert V.from_json(1, "boolean") is True

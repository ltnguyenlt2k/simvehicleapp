"""Runtime values and expression helpers (IR_SPEC "Semantics every backend implements", ADR-0040 §2).

A line-by-line port of the reference simulator's ``values.ts`` (ADR-0017): integer-typed values are Python
``int`` (exact, like ``bigint``), floats are ``float`` and ``float`` (binary32) results are rounded with
:func:`fround`. Every helper reproduces the JavaScript arithmetic the simulator uses (division by zero gives
±Infinity/NaN, ``%`` is ``fmod``, rounding is half away from zero) so a generated Python app and the
simulator agree on every value — the parity tests (P1, P3) check it.
"""

from __future__ import annotations

import json
import math
import re
import struct
from typing import Any, Optional

Value = Any

INT_BOUNDS = {
    "int8": (-(2**7), 2**7 - 1),
    "int16": (-(2**15), 2**15 - 1),
    "int32": (-(2**31), 2**31 - 1),
    "int64": (-(2**63), 2**63 - 1),
    "uint8": (0, 2**8 - 1),
    "uint16": (0, 2**16 - 1),
    "uint32": (0, 2**32 - 1),
    "uint64": (0, 2**64 - 1),
}
MAX_SAFE = 2**53 - 1


class EvalError(Exception):
    """A missing value or an index out of range: the node's ``error`` branch / ``onError`` (ADR-0017 Notes)."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message


def is_int_type(t: Optional[str]) -> bool:
    return t in INT_BOUNDS


def is_int_like(t: Optional[str]) -> bool:
    return is_int_type(t) or t in ("duration", "timestamp")


def is_number(v: Value) -> bool:
    """A JS number or bigint (a ``bool`` is not one: JS ``typeof true === "boolean"``)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def fround(x: float) -> float:
    """``Math.fround``: the nearest binary32."""
    if math.isnan(x) or math.isinf(x):
        return x
    try:
        return struct.unpack("f", struct.pack("f", x))[0]
    except OverflowError:
        return math.copysign(math.inf, x)


def js_number(v: Value) -> float:
    """``Number(v)``."""
    if v is None:
        return 0.0
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, int):
        return float(v)
    if isinstance(v, float):
        return v
    if isinstance(v, str):
        s = v.strip()
        if s == "":
            return 0.0
        try:
            if s.lower().startswith(("0x", "-0x", "+0x")):
                return math.nan if s[0] in "+-" else float(int(s, 16))
            if s in ("Infinity", "+Infinity"):
                return math.inf
            if s == "-Infinity":
                return -math.inf
            if any(c.isalpha() and c not in "eE" for c in s):
                return math.nan
            return float(s)
        except ValueError:
            return math.nan
    return math.nan


def js_truthy(v: Value) -> bool:
    """``Boolean(v)``."""
    if v is None:
        return False
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return not (v == 0 or (isinstance(v, float) and math.isnan(v)))
    if isinstance(v, str):
        return v != ""
    return True


def num(v: Value) -> float:
    return float(v) if isinstance(v, int) and not isinstance(v, bool) else js_number(v)


def big(v: Value) -> int:
    if isinstance(v, int) and not isinstance(v, bool):
        return v
    x = js_number(v)
    if math.isnan(x) or math.isinf(x):
        raise ValueError(f"cannot convert {x} to an integer")
    return int(x)  # Math.trunc


# ---- JS number formatting ---------------------------------------------------------------------------


def js_num_str(x: float) -> str:
    """``String(x)`` of a JS number (ECMAScript Number::toString, radix 10)."""
    if isinstance(x, int) and not isinstance(x, bool):
        return str(x)
    if math.isnan(x):
        return "NaN"
    if math.isinf(x):
        return "Infinity" if x > 0 else "-Infinity"
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    m = re.match(r"^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$", repr(abs(x)))  # shortest round-trip digits
    assert m
    ip, fp, ex = m.group(1), m.group(2) or "", int(m.group(3) or 0)
    raw = (ip + fp).lstrip("0")
    digits = raw.rstrip("0")
    k = len(digits)
    n = ex - len(fp) + (len(raw) - k) + k  # value = 0.d1…dk × 10^n
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    e = n - 1
    exp = ("+" if e >= 0 else "-") + str(abs(e))
    return sign + digits + "e" + exp if k == 1 else sign + digits[0] + "." + digits[1:] + "e" + exp


def js_string(v: Value) -> str:
    """``String(v)``."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if is_number(v):
        return js_num_str(v)
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return ",".join("" if x is None else js_string(x) for x in v)
    return "[object Object]"


def format_float32(x: float) -> str:
    """Shortest decimal that round-trips ``x`` as binary32 (template formatting of ``float``)."""
    if not math.isfinite(x):
        return js_num_str(x)
    for p in range(1, 10):
        s = float(f"{x:.{p - 1}e}")
        if fround(s) == x:
            return js_num_str(s)
    return js_num_str(x)


def js_json(v: Value) -> str:
    """``JSON.stringify`` (numbers as JS prints them, no spaces)."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return js_num_str(v) if math.isfinite(v) else "null"
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, (list, tuple)):
        return "[" + ",".join(js_json(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(json.dumps(str(k), ensure_ascii=False) + ":" + js_json(x) for k, x in v.items()) + "}"
    return json.dumps(v)


# ---- conversions --------------------------------------------------------------------------------------


def from_json(v: Value, type_: str) -> Value:
    """A JSON/scenario value converted to the runtime representation of ``type_``."""
    if v is None:
        return None
    if type_.endswith("[]"):
        return [from_json(x, type_[:-2]) for x in v]
    if is_int_like(type_):
        if isinstance(v, bool):
            return int(v)
        if isinstance(v, int):
            return v
        if isinstance(v, float):
            return int(v)
        return int(str(v))
    if type_ == "float":
        return fround(js_number(v))
    if type_ == "double":
        return js_number(v)
    if type_ == "boolean":
        return js_truthy(v)
    if type_ == "string":
        return js_string(v)
    return v


def to_json(v: Value, type_: Optional[str] = None) -> Value:
    """Runtime value to JSON for writes/trace: int64/uint64 (and wider than 2^53) as decimal strings."""
    if isinstance(v, int) and not isinstance(v, bool):
        if type_ in ("int64", "uint64"):
            return str(v)
        return v if -MAX_SAFE <= v <= MAX_SAFE else str(v)
    if isinstance(v, float) and v.is_integer() and abs(v) <= MAX_SAFE:
        return int(v)  # JSON of a JS number: 3 not 3.0
    if isinstance(v, list):
        el = type_[:-2] if type_ and type_.endswith("[]") else None
        return [to_json(x, el) for x in v]
    return v


def fmt(v: Value, type_: Optional[str] = None) -> str:
    """Template formatting (IR_SPEC "Formatting in templates")."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return format_float32(v) if type_ == "float" else js_num_str(v)
    if isinstance(v, str):
        return v
    return js_json(to_json(v, type_))


def round_half_away(x: float) -> float:
    """Round half away from zero (ADR-0014 Notes §11): ``Math.sign(x) * Math.round(Math.abs(x))``."""
    if math.isnan(x) or math.isinf(x):
        return x
    a = abs(x)
    r = math.floor(a)
    if a - r >= 0.5:  # exact: no `a + 0.5` rounding (Math.round(0.49999999999999994) is 0)
        r += 1
    return float(r) if x > 0 else -float(r) if r else (0.0 if x >= 0 else -0.0)


def cast(v: Value, to: str, from_: Optional[str] = None) -> Value:
    """``type.cast``: real ⇒ integer rounds half away from zero, NaN ⇒ 0, clamp; to string with the static type."""
    if is_int_type(to):
        lo, hi = INT_BOUNDS[to]
        if isinstance(v, int) and not isinstance(v, bool):
            b = v
        else:
            x = js_number(v)
            if math.isnan(x):
                b = 0
            elif x == math.inf:
                b = hi
            elif x == -math.inf:
                b = lo
            else:
                b = int(round_half_away(x))
        return lo if b < lo else hi if b > hi else b
    if to == "float":
        return fround(num(v))
    if to == "double":
        return num(v)
    if to == "string":
        return fmt(v, from_)
    if to == "boolean":
        return js_truthy(v)
    return v


def as_type(v: float, type_: str) -> Value:
    if is_int_like(type_):
        return big(v)
    if type_ == "float":
        return fround(float(v))
    return float(v)


# ---- operators (the cases of values.ts `evaluate`) -------------------------------------------------------


def arith(op: str, l: Value, r: Value, type_: str) -> Value:
    """``+ - *``: exact integers for integer results, else doubles (binary32 for ``float``)."""
    if is_int_like(type_):
        a, b = big(l), big(r)
        return a + b if op == "+" else a - b if op == "-" else a * b
    a, b = num(l), num(r)
    try:
        x = a + b if op == "+" else a - b if op == "-" else a * b
    except OverflowError:
        x = math.inf
    return as_type(x, type_)


def div(l: Value, r: Value) -> float:
    """JS ``/``: a double; by zero ⇒ ±Infinity, 0/0 ⇒ NaN."""
    a, b = num(l), num(r)
    if b == 0:
        if a == 0 or math.isnan(a):
            return math.nan
        return math.copysign(math.inf, a) * (1 if math.copysign(1, b) > 0 else -1)
    return a / b


def mod(l: Value, r: Value) -> float:
    """JS ``%`` (fmod; by zero ⇒ NaN)."""
    a, b = num(l), num(r)
    if b == 0 or math.isinf(a) or math.isnan(a) or math.isnan(b):
        return math.nan
    if math.isinf(b):
        return a
    return math.fmod(a, b)


def neg(a: Value) -> Value:
    return -a if isinstance(a, int) and not isinstance(a, bool) else -num(a)


def compare(op: str, l: Value, r: Value) -> bool:
    if is_number(l) and is_number(r):
        if isinstance(l, int) and isinstance(r, int):
            a, b = l, r
        else:
            a, b = num(l), num(r)
        if op == "==":
            return a == b
        if op == "!=":
            return a != b
        if op == "<":
            return a < b
        if op == "<=":
            return a <= b
        if op == ">":
            return a > b
        return a >= b
    if op == "==":
        return strict_eq(l, r)
    if op == "!=":
        return not strict_eq(l, r)
    return False


def strict_eq(l: Value, r: Value) -> bool:
    """JS ``===`` on non-number values (strings, booleans, null; arrays/objects by identity)."""
    if isinstance(l, bool) or isinstance(r, bool):
        return isinstance(l, bool) and isinstance(r, bool) and l == r
    if isinstance(l, (list, dict)) or isinstance(r, (list, dict)):
        return l is r
    return type(l) is type(r) and l == r


def land(l: Value, r_thunk) -> bool:
    return l is True and r_thunk() is True


def lor(l: Value, r_thunk) -> bool:
    return l is True or r_thunk() is True


def lnot(a: Value) -> bool:
    return a is not True


def pick(cond: Value, then_thunk, else_thunk) -> Value:
    """``?:``: only the chosen branch is evaluated."""
    return then_thunk() if cond is True else else_thunk()


def js_min(vs: list) -> float:
    xs = [num(v) for v in vs]
    return math.nan if any(math.isnan(x) for x in xs) else min(xs) if xs else math.inf


def js_max(vs: list) -> float:
    xs = [num(v) for v in vs]
    return math.nan if any(math.isnan(x) for x in xs) else max(xs) if xs else -math.inf


def abs_(a: Value) -> Value:
    return abs(a) if isinstance(a, int) and not isinstance(a, bool) else math.fabs(num(a))


def min_max(op: str, vs: list, type_: str) -> Value:
    if is_int_like(type_):
        bs = [big(v) for v in vs]
        return min(bs) if op == "min" else max(bs)
    return as_type(js_min(vs) if op == "min" else js_max(vs), type_)


def clamp(v: Value, lo: Value, hi: Value, type_: str) -> Value:
    if is_int_like(type_):
        a, l, h = big(v), big(lo), big(hi)
        return l if a < l else h if a > h else a
    return as_type(js_min([js_max([num(v), num(lo)]), num(hi)]), type_)


def round_(v: Value, digits: Optional[Value] = None) -> float:
    if digits is None:
        return round_half_away(num(v))
    f = 10 ** num(digits)
    return round_half_away(num(v) * f) / f


def floor_(v: Value) -> float:
    x = num(v)
    return x if math.isnan(x) or math.isinf(x) else float(math.floor(x))


def ceil_(v: Value) -> float:
    x = num(v)
    return x if math.isnan(x) or math.isinf(x) else float(math.ceil(x))


def scale(v: Value, a: Value, b: Value, c: Value, d: Value) -> float:
    vv, aa, bb, cc, dd = num(v), num(a), num(b), num(c), num(d)
    return cc + div((vv - aa) * (dd - cc), bb - aa)


def in_range(v: Value, lo: Value, hi: Value) -> bool:
    return compare(">=", v, lo) and compare("<=", v, hi)


def array_len(a: list) -> int:
    return len(a)


def array_contains(a: list, item: Value) -> bool:
    return any(compare("==", v, item) for v in a)


def array_at(a: list, index: Value, default_thunk=None) -> Value:
    i = big(index)
    if 0 <= i < len(a):
        return a[i]
    if default_thunk is not None:
        return default_thunk()
    raise EvalError("array_index_out_of_range", f"index {i} is outside 0…{len(a) - 1}")


def unit_convert(v: Value, scale_: Value, offset: Value) -> float:
    return num(v) * num(scale_) + num(offset)


def json_string(v: Value, type_: Optional[str] = None) -> str:
    return json.dumps(fmt(v, type_), ensure_ascii=False)


def template(*parts: str) -> str:
    return "".join(parts)

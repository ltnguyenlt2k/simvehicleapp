"""Closed set of ROS → RSS value transforms used by mapping.v1 (pure; Python ≥ 3.10; no ROS imports).

Messages are read by attribute (ROS messages) or by key (decoded schema-1 JSON). A transform returns None
when the value cannot be produced (missing field, NaN, name mismatch): the bridge then sends nothing,
and the broker ages the previous sample to STALE instead of inventing a value.
"""
from __future__ import annotations

import math
from typing import Any, Callable


def get(obj: Any, dotted: str) -> Any:
    for part in dotted.split("."):
        if obj is None:
            return None
        obj = obj.get(part) if isinstance(obj, dict) else getattr(obj, part, None)
    return obj


def _number(value: Any, scale: float = 1.0) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        out = float(value) * scale
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def _plain(value: Any) -> Any:
    if isinstance(value, bool) or isinstance(value, str) or value is None:
        return value
    if isinstance(value, (int, float)):
        return value if math.isfinite(float(value)) else None
    if hasattr(value, "item"):  # numpy scalar
        return _plain(value.item())
    return value


def field(msg, field: str, scale: float | None = None, **_):
    value = get(msg, field)
    if scale is not None:
        return _number(value, scale)
    if isinstance(value, bool):
        return value
    return _plain(value)


def quat(msg, field: str, axis: str, **_):
    q = get(msg, field)
    x, y, z, w = (_number(get(q, k)) for k in ("x", "y", "z", "w"))
    if None in (x, y, z, w) or (x == y == z == w == 0):
        return None
    if axis == "roll":
        return math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y))
    if axis == "pitch":
        return math.asin(max(-1.0, min(1.0, 2 * (w * y - z * x))))
    return math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


def array_index(msg, field: str, index: int, expect_name: str | None = None, **_):
    values = get(msg, field)
    if values is None or len(values) <= index:
        return None
    if expect_name is not None:
        names = list(get(msg, "feet") or [])
        if len(names) > index and names[index] != expect_name:
            return None
    value = values[index]
    return bool(value) if isinstance(value, (bool,)) or type(value).__name__ == "bool_" else _number(value)


def joint(msg, name: str, attr: str, **_):
    names = list(get(msg, "name") or [])
    values = list(get(msg, attr) or [])
    if name not in names:
        return None
    index = names.index(name)
    return _number(values[index]) if index < len(values) else None


def json_field(data, field: str, default: Any = None, map: dict | None = None, **_):  # noqa: A002
    value = get(data, field)
    if value is None:
        value = default
    if map is not None and value is not None:
        value = map.get(value, value)
    return _plain(value)


def json_in(data, field: str, values: list, **_):
    return get(data, field) in values


def json_not_null(data, field: str, **_):
    return get(data, field) is not None


def count_class(msg, class_id: str, as_bool: bool = False, **_):
    count = 0
    for detection in list(get(msg, "detections") or []):
        for result in list(get(detection, "results") or []):
            if get(result, "hypothesis.class_id") == class_id:
                count += 1
                break
    return count > 0 if as_bool else count


def min_finite(msg, field: str, **_):
    low = _number(get(msg, "range_min")) or 0.0
    high = _number(get(msg, "range_max")) or math.inf
    finite = [float(r) for r in (get(msg, field) or []) if math.isfinite(float(r)) and low <= float(r) <= high]
    return min(finite) if finite else None


TRANSFORMS: dict[str, Callable] = {
    "field": field, "quat": quat, "array_index": array_index, "joint": joint, "json_field": json_field,
    "json_in": json_in, "json_not_null": json_not_null, "count_class": count_class, "min_finite": min_finite,
}
# "fresh" and "age_ms" depend on receive time, computed by the bridge itself.
DERIVED = {"fresh", "age_ms"}


def substitute(template: Any, args: dict, arg_map: dict | None = None) -> Any:
    """Builds a Brain request from a mapping template: "$Name" → argument (optionally through argMap)."""
    if isinstance(template, dict):
        return {k: substitute(v, args, arg_map) for k, v in template.items()}
    if isinstance(template, list):
        return [substitute(v, args, arg_map) for v in template]
    if isinstance(template, str) and template.startswith("$"):
        if template.endswith("[X,Y]"):
            return [[float(p["X"]), float(p["Y"])] for p in args[template[1:-5]]]
        name = template[1:]
        value = args[name]
        if arg_map and name in arg_map:
            value = arg_map[name][value]
        return value
    return template

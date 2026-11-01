"""Typed access to an rss-catalog.v1 document (shared by broker, providers and runtime)."""
from __future__ import annotations

import hashlib
import json
import math
import pathlib
from dataclasses import dataclass

INT_TYPES = {"int32", "int64", "uint32"}
FLOAT_TYPES = {"float32", "float64"}


class CatalogError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Catalog:
    raw: dict

    @classmethod
    def load(cls, path: str | pathlib.Path) -> "Catalog":
        raw = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
        body = {k: v for k, v in raw.items() if k != "catalogHash"}
        digest = "sha256:" + hashlib.sha256(json.dumps(
            body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        if raw.get("schema") != "rss-catalog.v1" or raw.get("catalogHash") != digest:
            raise CatalogError("PB1001", "catalog file is not a valid rss-catalog.v1 (hash mismatch)")
        return cls(raw)

    @property
    def hash(self) -> str:
        return self.raw["catalogHash"]

    @property
    def nodes(self) -> dict[str, dict]:
        return self.raw["nodes"]

    def leaves(self, kinds: tuple[str, ...] | None = None) -> list[str]:
        return [p for p, n in self.nodes.items() if n["kind"] != "branch" and (kinds is None or n["kind"] in kinds)]

    def node(self, path: str, *kinds: str) -> dict:
        node = self.nodes.get(path)
        if node is None or node["kind"] == "branch":
            raise CatalogError("PB1101", f"unknown RSS path {path}")
        if kinds and node["kind"] not in kinds:
            raise CatalogError("PB1102", f"{path} is a {node['kind']}, expected {'/'.join(kinds)}")
        return node

    def expand(self, patterns: list[str]) -> list[str]:
        """Exact leaf paths or 'Branch.*' (all leaves below)."""
        out: list[str] = []
        for pattern in patterns:
            if pattern.endswith(".*"):
                stem = pattern[:-2] + "."
                hits = [p for p in self.leaves() if p.startswith(stem)]
                if not hits:
                    raise CatalogError("PB1101", f"no leaves under {pattern}")
                out += hits
            else:
                self.node(pattern)
                out.append(pattern)
        return sorted(set(out))

    def max_age_ns(self, path: str) -> int | None:
        age = self.nodes[path].get("maxAgeMs")
        return age * 1_000_000 if age else None

    # ------------------------------------------------------------ value checks

    def check_setpoint(self, path: str, fields: dict[str, float]) -> dict[str, float]:
        node = self.node(path, "setpoint")
        spec = node["fields"]
        if set(fields) != set(spec):
            raise CatalogError("PB1301", f"{path} needs exactly fields {sorted(spec)}")
        for name, value in fields.items():
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
                raise CatalogError("PB1301", f"{path}.{name} must be a finite number")
            low, high = spec[name].get("min", -math.inf), spec[name].get("max", math.inf)
            if not low <= value <= high:
                raise CatalogError("PB1302", f"{path}.{name}={value} outside [{low}, {high}]")
        return {k: float(v) for k, v in fields.items()}

    def safe_value(self, path: str) -> dict[str, float]:
        return {k: float(v) for k, v in self.node(path, "setpoint")["safeValue"].items()}

    def check_args(self, path: str, args: dict) -> dict:
        node = self.node(path, "command")
        _check_fields(path, node["args"], args)
        return args


def _check_fields(where: str, spec: dict, values: dict) -> None:
    if not isinstance(values, dict) or set(values) != set(spec):
        raise CatalogError("PB1401", f"{where} needs exactly arguments {sorted(spec)}")
    for name, field in spec.items():
        value = values[name]
        at = f"{where}.{name}"
        kind = field["type"]
        if kind == "array":
            if not isinstance(value, list) or not 1 <= len(value) <= field["maxItems"]:
                raise CatalogError("PB1401", f"{at} needs 1..{field['maxItems']} items")
            for index, item in enumerate(value):
                _check_fields(f"{at}[{index}]", field["items"], item)
            continue
        if kind == "enum":
            if value not in field["values"]:
                raise CatalogError("PB1401", f"{at}={value!r} not in {field['values']}")
            continue
        if kind == "bool":
            if not isinstance(value, bool):
                raise CatalogError("PB1401", f"{at} must be a boolean")
            continue
        if kind == "string":
            if not isinstance(value, str) or len(value) > 1024:
                raise CatalogError("PB1401", f"{at} must be a string (≤ 1024)")
            continue
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            raise CatalogError("PB1401", f"{at} must be a finite number")
        if kind in INT_TYPES and float(value) != int(value):
            raise CatalogError("PB1401", f"{at} must be an integer")
        low, high = field.get("min", -math.inf), field.get("max", math.inf)
        if not low <= value <= high:
            raise CatalogError("PB1401", f"{at}={value} outside [{low}, {high}]")

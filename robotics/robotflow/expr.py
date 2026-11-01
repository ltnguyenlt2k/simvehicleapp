"""RobotFlow expressions: tokenizer + Pratt parser + type/unit check + Python code generation (no eval).

    Robot.PowerSystem.Battery.StateOfCharge < 20 % and not Robot.Motion.IsBodyBusy
    Robot.Safety.Mode == "MANUAL" or Robot.Obstacle.MinRange <= 0.8 m
"""
from __future__ import annotations

import re
from dataclasses import dataclass

UNITS = {"m", "m/s", "m/s^2", "rad", "rad/s", "deg", "N", "N.m", "V", "A", "%", "s", "ms", "Hz", "degC"}
CONVERT = {("deg", "rad"): 0.017453292519943295, ("rad", "deg"): 57.29577951308232, ("ms", "s"): 0.001, ("s", "ms"): 1000.0}
NUMERIC = {"int32", "int64", "uint32", "float32", "float64"}
TOKEN = re.compile(r"""\s*(?:
    (?P<number>\d+(?:\.\d+)?)|
    (?P<string>"[^"\\]{0,200}")|
    (?P<path>Robot(?:\.[A-Za-z][A-Za-z0-9]*)+)|
    (?P<word>[A-Za-z_][A-Za-z0-9_]*)|
    (?P<op>==|!=|<=|>=|<|>|\(|\)|\+|-|\*|/|%)
)""", re.X)


class ExprError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


@dataclass(frozen=True)
class Typed:
    kind: str           # bool | number | string
    unit: str = ""
    values: tuple = ()  # enum values when known


def tokenize(text: str) -> list[tuple[str, str]]:
    tokens, pos = [], 0
    text = text.strip()
    while pos < len(text):
        match = TOKEN.match(text, pos)
        if not match or match.end() == pos:
            raise ExprError("RF2001", f"unexpected text at position {pos}: {text[pos:pos + 12]!r}")
        kind = match.lastgroup
        tokens.append((kind, match.group(kind)))
        pos = match.end()
    if len(tokens) > 200:
        raise ExprError("RF2001", "expression is too long")
    return tokens


class Parser:
    BINARY = {"or": 1, "and": 2, "==": 4, "!=": 4, "<": 4, "<=": 4, ">": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6}

    def __init__(self, text: str, catalog_nodes: dict):
        self.tokens = tokenize(text)
        self.i = 0
        self.nodes = catalog_nodes
        self.paths: set[str] = set()

    def peek(self):
        return self.tokens[self.i] if self.i < len(self.tokens) else (None, None)

    def take(self):
        token = self.peek()
        self.i += 1
        return token

    def parse(self) -> tuple[str, Typed]:
        if not self.tokens:
            raise ExprError("RF2001", "empty expression")
        code, typed = self.expression(0)
        if self.i != len(self.tokens):
            raise ExprError("RF2001", f"unexpected {self.peek()[1]!r}")
        return code, typed

    def op_of(self, token):
        kind, value = token
        if kind == "op" and value in self.BINARY:
            return value
        if kind == "word" and value in ("and", "or"):
            return value
        return None

    def expression(self, min_bp: int) -> tuple[str, Typed]:
        left = self.prefix()
        while True:
            op = self.op_of(self.peek())
            if op is None or self.BINARY[op] <= min_bp:
                return left
            self.take()
            right = self.expression(self.BINARY[op])
            left = self.combine(op, left, right)

    def prefix(self) -> tuple[str, Typed]:
        kind, value = self.take()
        if kind is None:
            raise ExprError("RF2001", "expression ends unexpectedly")
        if kind == "number":
            unit = ""
            nxt = self.peek()
            if nxt[0] in ("word", "op") and self._unit_ahead():
                unit = self._read_unit()
            return repr(float(value)), Typed("number", unit)
        if kind == "string":
            return repr(value[1:-1]), Typed("string")
        if kind == "path":
            node = self.nodes.get(value)
            if node is None or node["kind"] not in ("sensor", "attribute"):
                raise ExprError("RF2002", f"{value} is not a readable signal of this robot")
            self.paths.add(value)
            vtype = node["type"]
            typed = (Typed("bool") if vtype == "bool" else Typed("number", node.get("unit", "")) if vtype in NUMERIC
                     else Typed("string", "", tuple(node.get("values", ()))))
            return f"v({value!r})", typed
        if kind == "word" and value in ("true", "false"):
            return ("True" if value == "true" else "False"), Typed("bool")
        if kind == "word" and value == "not":
            code, typed = self.expression(3)
            if typed.kind != "bool":
                raise ExprError("RF2003", "'not' needs a boolean")
            return f"(not {code})", Typed("bool")
        if kind == "op" and value == "-":
            code, typed = self.expression(7)
            if typed.kind != "number":
                raise ExprError("RF2003", "'-' needs a number")
            return f"(-{code})", typed
        if kind == "op" and value == "(":
            inner = self.expression(0)
            if self.take() != ("op", ")"):
                raise ExprError("RF2001", "missing ')'")
            return f"({inner[0]})", inner[1]
        raise ExprError("RF2001", f"unexpected {value!r}")

    def _unit_ahead(self) -> bool:
        values = [v for _, v in self.tokens[self.i:self.i + 3]]
        return any("".join(values[:count]) in UNITS for count in (3, 2, 1) if len(values) >= count)

    def _read_unit(self) -> str:
        values = [v for _, v in self.tokens[self.i:self.i + 3]]
        for count in (3, 2, 1):
            if len(values) >= count and "".join(values[:count]) in UNITS:
                self.i += count
                return "".join(values[:count])
        raise ExprError("RF2004", "unknown unit")

    def combine(self, op: str, left, right) -> tuple[str, Typed]:
        (lc, lt), (rc, rt) = left, right
        if op in ("and", "or"):
            if lt.kind != "bool" or rt.kind != "bool":
                raise ExprError("RF2003", f"'{op}' needs booleans")
            return f"({lc} {op} {rc})", Typed("bool")
        if op in ("==", "!=", "<", "<=", ">", ">="):
            if lt.kind != rt.kind:
                raise ExprError("RF2003", f"cannot compare {lt.kind} with {rt.kind}")
            if lt.kind == "number":
                lc, rc = self._align(lc, lt, rc, rt)
            elif lt.kind != "number" and op not in ("==", "!="):
                raise ExprError("RF2003", f"'{op}' needs numbers")
            for typed, code in ((lt, rc), (rt, lc)):
                if typed.values and code.startswith("'") and code.strip("'") not in typed.values:
                    raise ExprError("RF2005", f"{code} is not one of {list(typed.values)}")
            return f"({lc} {op} {rc})", Typed("bool")
        if lt.kind != "number" or rt.kind != "number":
            raise ExprError("RF2003", f"'{op}' needs numbers")
        if op in ("+", "-"):
            lc, rc = self._align(lc, lt, rc, rt)
            return f"({lc} {op} {rc})", Typed("number", lt.unit or rt.unit)
        return f"({lc} {op} {rc})", Typed("number", lt.unit if not rt.unit else (rt.unit if not lt.unit else ""))

    @staticmethod
    def _align(lc, lt: Typed, rc, rt: Typed):
        if not lt.unit or not rt.unit or lt.unit == rt.unit:
            return lc, rc
        factor = CONVERT.get((rt.unit, lt.unit))
        if factor is None:
            raise ExprError("RF2004", f"unit {rt.unit} is not comparable with {lt.unit}")
        return lc, f"({rc} * {factor!r})"


def compile_condition(text: str, catalog_nodes: dict) -> tuple[str, list[str]]:
    parser = Parser(text, catalog_nodes)
    code, typed = parser.parse()
    if typed.kind != "bool":
        raise ExprError("RF2006", "a condition must be true/false (use a comparison)")
    return code, sorted(parser.paths)


TEMPLATE = re.compile(r"\{\{\s*(Robot(?:\.[A-Za-z][A-Za-z0-9]*)+)\s*\}\}")


def template_paths(text: str, catalog_nodes: dict) -> list[str]:
    paths = TEMPLATE.findall(text)
    for path in paths:
        node = catalog_nodes.get(path)
        if node is None or node["kind"] not in ("sensor", "attribute"):
            raise ExprError("RF2002", f"{path} is not a readable signal of this robot")
    return sorted(set(paths))

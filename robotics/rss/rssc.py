"""rssc — RSS spec validator, catalog builder, reference docs and diff (ADR-0065).

    python -m rss.rssc validate
    python -m rss.rssc build --profile dog-go2-sim --out runtime/rss/dog-go2-sim.json
    python -m rss.rssc docs --profile dog-go2-sim --out ../docs/reference/rss
    python -m rss.rssc diff OLD.json NEW.json

Output is deterministic: the same sources give the same catalog bytes and catalogHash.
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import itertools
import json
import pathlib
import sys
from dataclasses import dataclass

import jsonschema
import yaml

HERE = pathlib.Path(__file__).resolve().parent
SPEC_DIR = HERE / "spec"
CONTRACTS = HERE.parent / "contracts" / "schemas"
NUMERIC = {"int32", "int64", "uint32", "float32", "float64"}
TYPE_RANGE = {"int32": (-2**31, 2**31 - 1), "int64": (-2**63, 2**63 - 1), "uint32": (0, 2**32 - 1)}


@dataclass(frozen=True)
class Diagnostic:
    code: str
    path: str
    message: str

    def __str__(self) -> str:
        return f"{self.code} {self.path}: {self.message}"


class RssError(Exception):
    def __init__(self, diagnostics: list[Diagnostic]):
        super().__init__("\n".join(map(str, diagnostics)))
        self.diagnostics = diagnostics


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def _schema(name: str) -> jsonschema.Draft202012Validator:
    return jsonschema.Draft202012Validator(json.loads((CONTRACTS / name).read_text()))


def _yaml(path: pathlib.Path):
    with path.open(encoding="utf-8") as stream:
        return yaml.safe_load(stream)


def load_units(spec_dir: pathlib.Path = SPEC_DIR) -> set[str]:
    return set(_yaml(spec_dir / "units.yaml")["units"])


# ---------------------------------------------------------------- core


def load_core(spec_dir: pathlib.Path = SPEC_DIR) -> dict[str, dict]:
    """Merges spec/core/*.rss.yaml; schema and duplicate checks only."""
    validator = _schema("rss-spec.v1.json")
    nodes: dict[str, dict] = {}
    origin: dict[str, str] = {}
    problems: list[Diagnostic] = []
    for file in sorted((spec_dir / "core").glob("*.rss.yaml")):
        data = _yaml(file)
        for error in validator.iter_errors(data):
            where = "/".join(map(str, error.absolute_path)) or file.name
            problems.append(Diagnostic("RS1001", where, f"{file.name}: {error.message}"))
        if not isinstance(data, dict) or data.get("kind") != "core":
            continue
        for path, node in (data.get("nodes") or {}).items():
            if path in nodes:
                problems.append(Diagnostic("RS1002", path, f"defined in {origin[path]} and {file.name}"))
            nodes[path], origin[path] = node, file.name
    if problems:
        raise RssError(problems)
    return nodes


def _check_range(path: str, spec: dict, problems: list[Diagnostic]) -> None:
    low, high = spec.get("min"), spec.get("max")
    if low is not None and high is not None and low > high:
        problems.append(Diagnostic("RS1006", path, f"min {low} > max {high}"))
    kind = spec.get("type")
    if kind in TYPE_RANGE:
        tlow, thigh = TYPE_RANGE[kind]
        for bound in (low, high):
            if bound is not None and not tlow <= bound <= thigh:
                problems.append(Diagnostic("RS1006", path, f"bound {bound} outside {kind}"))
    if ("min" in spec or "max" in spec or "unit" in spec) and kind not in NUMERIC:
        problems.append(Diagnostic("RS1009", path, f"min/max/unit need a numeric type, not {kind}"))
    if (kind == "enum") != ("values" in spec):
        problems.append(Diagnostic("RS1009", path, "enum needs values; values need type enum"))


def _check_field_map(path: str, fields: dict, units: set[str], problems: list[Diagnostic]) -> None:
    for name, spec in fields.items():
        where = f"{path}.{name}"
        if not name[:1].isupper():
            problems.append(Diagnostic("RS1001", where, "field names are PascalCase"))
        if spec.get("unit") and spec["unit"] not in units:
            problems.append(Diagnostic("RS1005", where, f"unknown unit {spec['unit']!r}"))
        if spec["type"] == "array":
            if "items" not in spec or "maxItems" not in spec:
                problems.append(Diagnostic("RS1009", where, "array needs items and maxItems"))
            else:
                _check_field_map(where, spec["items"], units, problems)
            continue
        _check_range(where, spec, problems)


def check_core(nodes: dict[str, dict], units: set[str]) -> list[Diagnostic]:
    problems: list[Diagnostic] = []
    if "Robot" not in nodes or nodes["Robot"]["kind"] != "branch":
        problems.append(Diagnostic("RS1003", "Robot", "root branch Robot is required"))
    for path, node in nodes.items():
        kind = node["kind"]
        parent = path.rpartition(".")[0]
        if parent and (parent not in nodes):
            problems.append(Diagnostic("RS1003", path, f"parent {parent} is not defined"))
        elif parent and nodes[parent]["kind"] != "branch":
            problems.append(Diagnostic("RS1004", path, f"parent {parent} is a {nodes[parent]['kind']}, not a branch"))
        if "instances" in node and kind != "branch":
            problems.append(Diagnostic("RS1008", path, "only branches have instances"))
        leaf = path.rpartition(".")[2]
        if node.get("type") == "bool" and not leaf.startswith(("Is", "Has")):
            problems.append(Diagnostic("RS1010", path, "boolean names start with Is or Has"))
        if node.get("unit") and node["unit"] not in units:
            problems.append(Diagnostic("RS1005", path, f"unknown unit {node['unit']!r}"))
        if kind in ("sensor", "attribute"):
            _check_range(path, node, problems)
        for key in ("fields", "args"):
            if key in node:
                _check_field_map(path, node[key], units, problems)
        if kind == "setpoint":
            fields, safe = node["fields"], node["safeValue"]
            if set(safe) != set(fields):
                problems.append(Diagnostic("RS1007", path, "safeValue must give every field exactly once"))
            for name, value in safe.items():
                spec = fields.get(name, {})
                if not isinstance(value, (int, float)) or isinstance(value, bool):
                    problems.append(Diagnostic("RS1007", path, f"safeValue.{name} must be numeric"))
                elif ("min" in spec and value < spec["min"]) or ("max" in spec and value > spec["max"]):
                    problems.append(Diagnostic("RS1007", path, f"safeValue.{name} outside its range"))
        if kind == "command" and node.get("safetyLane") and "REJECTED" in node["results"]:
            problems.append(Diagnostic("RS1015", path, "a safety-lane command is always accepted (no REJECTED)"))
    return problems


# ---------------------------------------------------------------- expansion and profile


def expand(nodes: dict[str, dict]) -> dict[str, dict]:
    """Inserts branch instances after their branch (VSS style); instance segments become branches."""
    out: dict[str, dict] = {}
    for path, node in nodes.items():
        parts = path.split(".")
        choices: list[list[str]] = []
        for index in range(len(parts)):
            prefix = ".".join(parts[: index + 1])
            segment = [parts[index]]
            instances = nodes.get(prefix, {}).get("instances") if prefix != path else None
            choices.append([f"{parts[index]}.{inst}" for inst in instances] if instances else segment)
        for combo in itertools.product(*choices):
            concrete = ".".join(combo)
            out[concrete] = {k: v for k, v in node.items() if k != "instances"}
        instances = node.get("instances")
        if instances:
            for combo in itertools.product(*choices):
                base = ".".join(combo)
                for inst in instances:
                    out[f"{base}.{inst}"] = {"kind": "branch", "description": f"{inst} instance of {path}."}
    return dict(sorted(out.items()))


def _matches(path: str, pattern: str) -> bool:
    if pattern.endswith(".*"):
        stem = pattern[:-2]
        return path == stem or path.startswith(stem + ".")
    return fnmatch.fnmatchcase(path, pattern)


def _narrow_spec(where: str, base: dict, change: dict, problems: list[Diagnostic]) -> dict:
    result = dict(base)
    for key, value in change.items():
        if key == "min":
            if "min" in base and value < base["min"]:
                problems.append(Diagnostic("RS1012", where, f"min {value} widens core {base['min']}"))
        elif key == "max":
            if "max" in base and value > base["max"]:
                problems.append(Diagnostic("RS1012", where, f"max {value} widens core {base['max']}"))
        elif key == "maxItems":
            if value > base.get("maxItems", value):
                problems.append(Diagnostic("RS1012", where, "maxItems widens core"))
        elif key == "values":
            if not set(value) <= set(base.get("values", [])):
                problems.append(Diagnostic("RS1012", where, "values must be a subset of core values"))
        else:
            problems.append(Diagnostic("RS1012", where, f"{key} cannot be narrowed"))
            continue
        result[key] = value
    return result


def apply_profile(core: dict[str, dict], profile: dict) -> tuple[dict[str, dict], list[Diagnostic]]:
    problems: list[Diagnostic] = []
    selected: dict[str, dict] = {}
    for pattern in profile["include"]:
        hits = [path for path in core if _matches(path, pattern)]
        if not hits:
            problems.append(Diagnostic("RS1011", pattern, "include matches no core node"))
        for path in hits:
            selected[path] = json.loads(json.dumps(core[path]))
    for path in list(selected):  # ancestors keep the tree navigable
        parent = path.rpartition(".")[0]
        while parent and parent not in selected:
            selected[parent] = json.loads(json.dumps(core[parent]))
            parent = parent.rpartition(".")[0]
    for path, change in (profile.get("narrow") or {}).items():
        node = selected.get(path)
        if node is None:
            problems.append(Diagnostic("RS1012", path, "narrow targets a node that is not included"))
            continue
        for key, value in change.items():
            if key in ("fields", "args"):
                for name, field_change in value.items():
                    if name not in node.get(key, {}):
                        problems.append(Diagnostic("RS1012", f"{path}.{name}", "unknown field"))
                        continue
                    node[key][name] = _narrow_spec(f"{path}.{name}", node[key][name], field_change, problems)
            else:
                selected[path] = node = _narrow_spec(path, node, {key: value}, problems)
    for path, value in (profile.get("attributes") or {}).items():
        node = selected.get(path)
        if not node or node["kind"] != "attribute":
            problems.append(Diagnostic("RS1013", path, "attribute value for a missing or non-attribute node"))
            continue
        if node["type"] == "enum" and value not in node["values"]:
            problems.append(Diagnostic("RS1013", path, f"{value!r} not in {node['values']}"))
        node["value"] = value
    for path, note in (profile.get("pending") or {}).items():
        if path not in selected:
            problems.append(Diagnostic("RS1014", path, "pending marks a node that is not included"))
            continue
        selected[path]["pending"] = note
    for path, node in selected.items():
        if node["kind"] == "setpoint":
            for name, value in node["safeValue"].items():
                spec = node["fields"][name]
                if value < spec.get("min", value) or value > spec.get("max", value):
                    problems.append(Diagnostic("RS1007", path, f"safeValue.{name} outside the narrowed range"))
    return dict(sorted(selected.items())), problems


def load_profile(profile_id: str, spec_dir: pathlib.Path = SPEC_DIR) -> dict:
    file = spec_dir / "profiles" / f"{profile_id}.rss.yaml"
    if not file.is_file():
        raise RssError([Diagnostic("RS1011", profile_id, "profile not found")])
    data = _yaml(file)
    problems = [Diagnostic("RS1001", "/".join(map(str, e.absolute_path)) or file.name, e.message)
                for e in _schema("rss-spec.v1.json").iter_errors(data)]
    if not problems and data.get("kind") != "profile":
        problems.append(Diagnostic("RS1001", file.name, "not a profile"))
    if not problems and data["id"] != profile_id:
        problems.append(Diagnostic("RS1001", file.name, "id must match the file name"))
    if problems:
        raise RssError(problems)
    return data


def build(profile_id: str, spec_dir: pathlib.Path = SPEC_DIR) -> dict:
    units = load_units(spec_dir)
    core = load_core(spec_dir)
    problems = check_core(core, units)
    if problems:
        raise RssError(problems)
    profile = load_profile(profile_id, spec_dir)
    nodes, problems = apply_profile(expand(core), profile)
    if problems:
        raise RssError(problems)
    catalog = {"schema": "rss-catalog.v1", "rss": "0.1", "profile": profile_id,
               "robot": dict(sorted((profile.get("robot") or {}).items())), "nodes": nodes}
    catalog["catalogHash"] = "sha256:" + hashlib.sha256(canonical(catalog)).hexdigest()
    errors = list(_schema("rss-catalog.v1.json").iter_errors(catalog))
    if errors:
        raise RssError([Diagnostic("RS1001", "/".join(map(str, e.absolute_path)), e.message) for e in errors])
    return catalog


def catalog_bytes(catalog: dict) -> bytes:
    return json.dumps(catalog, sort_keys=True, indent=1, ensure_ascii=False, allow_nan=False).encode() + b"\n"


def verify_hash(catalog: dict) -> bool:
    body = {k: v for k, v in catalog.items() if k != "catalogHash"}
    return catalog.get("catalogHash") == "sha256:" + hashlib.sha256(canonical(body)).hexdigest()


# ---------------------------------------------------------------- docs and diff


def _describe(node: dict) -> str:
    kind = node["kind"]
    if kind in ("sensor", "attribute"):
        bits = [node["type"]]
        if "unit" in node:
            bits.append(node["unit"])
        if "values" in node:
            bits.append("{" + ", ".join(node["values"]) + "}")
        if "min" in node or "max" in node:
            bits.append(f"[{node.get('min', '')}, {node.get('max', '')}]")
        if "maxAgeMs" in node:
            bits.append(f"maxAge {node['maxAgeMs']} ms")
        if "value" in node:
            bits.append(f"= {node['value']}")
        return " ".join(bits)

    def fields(spec: dict) -> str:
        out = []
        for name, f in spec.items():
            if f["type"] == "array":
                out.append(f"{name}: array≤{f['maxItems']} of ({fields(f['items'])})")
                continue
            rng = f" [{f.get('min', '')}, {f.get('max', '')}]" if "min" in f or "max" in f else ""
            vals = " {" + ", ".join(f["values"]) + "}" if "values" in f else ""
            out.append(f"{name}: {f['type']}{' ' + f['unit'] if 'unit' in f else ''}{rng}{vals}")
        return "; ".join(out)

    if kind == "setpoint":
        return f"{fields(node['fields'])} · ttl {node['ttlMs']} ms · {node['refreshHz']} Hz · safe {json.dumps(node['safeValue'])}"
    if kind == "command":
        return f"{fields(node['args']) or '—'} · timeout {node['timeoutMs']} ms · {'/'.join(node['results'])}"
    if kind == "event":
        return fields(node["fields"])
    return ""


def docs(catalog: dict) -> dict[str, str]:
    """Markdown reference, one page per top-level branch plus an index."""
    groups: dict[str, list[tuple[str, dict]]] = {}
    for path, node in catalog["nodes"].items():
        parts = path.split(".")
        if len(parts) < 2:
            continue
        groups.setdefault(parts[1], []).append((path, node))
    head = (f"<!-- generated by rssc from profile {catalog['profile']} ({catalog['catalogHash']}); do not edit -->\n")
    pages = {}
    index = [head, f"# RSS reference — profile `{catalog['profile']}`\n",
             f"Catalog hash `{catalog['catalogHash']}`. Leaf nodes: "
             f"{sum(n['kind'] != 'branch' for n in catalog['nodes'].values())}.\n", "| Branch | Leaves |", "|---|---|"]
    for group, rows in sorted(groups.items()):
        leaves = [(p, n) for p, n in rows if n["kind"] != "branch"]
        index.append(f"| [{group}]({group}.md) | {len(leaves)} |")
        lines = [head, f"# Robot.{group}\n", "| Path | Kind | Definition | Note |", "|---|---|---|---|"]
        for path, node in leaves:
            note = node.get("pending", "")
            lines.append(f"| `{path}` | {node['kind']} | {_describe(node)} | {node['description']}"
                         f"{' **Pending: ' + note + '**' if note else ''} |")
        pages[f"{group}.md"] = "\n".join(lines) + "\n"
    pages["README.md"] = "\n".join(index) + "\n"
    return pages


def diff(old: dict, new: dict) -> dict:
    added = sorted(set(new["nodes"]) - set(old["nodes"]))
    removed = sorted(set(old["nodes"]) - set(new["nodes"]))
    changed = sorted(p for p in set(old["nodes"]) & set(new["nodes"]) if old["nodes"][p] != new["nodes"][p])
    breaking = removed + [p for p in changed if any(
        old["nodes"][p].get(k) != new["nodes"][p].get(k) for k in ("kind", "type", "unit"))]
    return {"added": added, "removed": removed, "changed": changed,
            "level": "major" if breaking else ("minor" if added or changed else "none"), "breaking": sorted(breaking)}


# ---------------------------------------------------------------- CLI


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="rssc")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("validate")
    for name in ("build", "docs"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--profile", required=True)
        cmd.add_argument("--out", required=True)
    cmp = sub.add_parser("diff")
    cmp.add_argument("old")
    cmp.add_argument("new")
    args = parser.parse_args(argv)
    try:
        if args.command == "validate":
            profiles = sorted(p.name.removesuffix(".rss.yaml") for p in (SPEC_DIR / "profiles").glob("*.rss.yaml"))
            for profile in profiles:
                catalog = build(profile)
                print(f"OK {profile} {catalog['catalogHash']} nodes={len(catalog['nodes'])}")
        elif args.command == "build":
            out = pathlib.Path(args.out)
            out.parent.mkdir(parents=True, exist_ok=True)
            catalog = build(args.profile)
            out.write_bytes(catalog_bytes(catalog))
            print(catalog["catalogHash"])
        elif args.command == "docs":
            out = pathlib.Path(args.out)
            out.mkdir(parents=True, exist_ok=True)
            for name, text in docs(build(args.profile)).items():
                (out / name).write_text(text, encoding="utf-8")
            print(f"wrote {out}")
        else:
            load = lambda p: json.loads(pathlib.Path(p).read_text())
            print(json.dumps(diff(load(args.old), load(args.new)), indent=1))
    except RssError as error:
        for item in error.diagnostics:
            print(item, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

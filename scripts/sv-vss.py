#!/usr/bin/env python3
"""sv vss — custom VSS models on the running stack (ADR-0052).

  scripts/sv vss list
  scripts/sv vss add <vX.Y-name> <model.json>               a whole VSS JSON (e.g. exported by vss-tools from your .vspec)
  scripts/sv vss add <vX.Y-name> --overlay <overlay.json>   your signals merged onto COVESA vX.Y (the seeded release)
  scripts/sv vss use <vX.Y-name>                            Run/inject on it: databroker-custom loads it (one at a time)
  scripts/sv vss remove <vX.Y-name>

A custom model is a release `vX.Y-<name>` (lowercase letters, digits, inner dashes). It lives in the compose volume
sv-vss-custom; vss-catalog serves it next to v4.0/v4.2, so blocks, lint, compile, SynCode and projects use it like a
COVESA release. Changing it later is safe: a project on it gets the new file at its next SynCode (workspace vss-sync)
and the toolchain regenerates the vehicle model. The catalog validates the model when it is added.

Overlay format: the VSS JSON tree (as in vss_rel_X.Y.json) with only the nodes you add or change, e.g.
  {"Vehicle": {"children": {"Acme": {"type": "branch", "description": "…", "children": {
      "WarningLevel": {"type": "actuator", "datatype": "uint8", "description": "…"}}}}}}
An existing node keeps its attributes unless the overlay sets them; new children are appended in overlay order.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "modules" / "velocitas-stack" / "vss"
RELEASE = re.compile(r"^v([0-9]+)\.([0-9]+)-([a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?)$")
VOLUME_DIR = "/var/lib/sv-vss-custom"
CUSTOM_BROKER = "databroker-custom:55555"
DEFAULT_BROKERS = "v4.0=databroker:55555,v4.2=databroker-v4-2:55555"
NODE_TYPES = {"branch", "sensor", "actuator", "attribute", "struct", "property"}


class Fail(Exception):
    pass


def check_release(release: str) -> re.Match[str]:
    m = RELEASE.match(release)
    if not m:
        raise Fail(f"{release}: a custom model is named vX.Y-<name> (lowercase letters, digits, inner dashes), e.g. v4.0-acme")
    return m


def merge(base: dict, overlay: dict) -> dict:
    """Merges an overlay document onto a VSS JSON document (both: {root name: node}): overlay attributes win,
    children merge by name, new children keep overlay order."""
    if not isinstance(overlay, dict):
        raise Fail("an overlay is a JSON object like the VSS document ({\"Vehicle\": {...}})")
    return merge_node({"children": base}, {"children": overlay})["children"]


def merge_node(base: dict, overlay: dict, path: str = "") -> dict:
    out = dict(base)
    for key, value in overlay.items():
        if key == "children":
            if not isinstance(value, dict):
                raise Fail(f"{path or '<root>'}: children must be an object")
            children = dict(base.get("children") or {})
            for name, node in value.items():
                if not isinstance(node, dict):
                    raise Fail(f"{path}.{name}: a node must be an object")
                child = f"{path}.{name}" if path else name
                children[name] = merge_node(children[name], node, child) if name in children else check_new(node, child)
            out["children"] = children
        else:
            out[key] = value
    return out


def check_new(node: dict, path: str) -> dict:
    """A node the overlay adds must be complete (the catalog checks the rest when it loads the model)."""
    kind = node.get("type")
    if kind not in NODE_TYPES:
        raise Fail(f"{path}: type must be one of {', '.join(sorted(NODE_TYPES))}")
    if not node.get("description"):
        raise Fail(f"{path}: description is required (VSS)")
    if kind in {"sensor", "actuator", "attribute", "property"} and not node.get("datatype"):
        raise Fail(f"{path}: datatype is required for a {kind}")
    for name, child in (node.get("children") or {}).items():
        check_new(child, f"{path}.{name}")
    return node


def build_document(release: str, source: Path | None, overlay: Path | None) -> dict:
    if overlay:
        m = check_release(release)
        base_file = SEED / f"vss_rel_{m.group(1)}.{m.group(2)}.json"
        if not base_file.exists():
            raise Fail(f"no seeded COVESA v{m.group(1)}.{m.group(2)} to overlay (have: {', '.join(sorted(p.stem[8:] for p in SEED.glob('vss_rel_*.json')))})")
        base = json.loads(base_file.read_text(encoding="utf-8"))
        doc = merge(base, load_json(overlay))
    else:
        doc = load_json(source)
    if not isinstance(doc, dict) or len(doc) != 1 or not isinstance(next(iter(doc.values())), dict):
        raise Fail("a VSS JSON document has exactly one root node (e.g. {\"Vehicle\": {...}})")
    return doc


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise Fail(f"{path}: {e}") from e


def compose(*args: str, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["docker", "compose", *args], cwd=ROOT, text=True, capture_output=capture, check=False)


def catalog_get(path: str) -> tuple[int, str]:
    script = (
        "const r = await fetch('http://127.0.0.1:4010' + process.argv[1], { headers: { 'x-sv-internal': process.env.INTERNAL_API_SECRET } });"
        "console.log(r.status); console.log(await r.text());"
    )
    p = compose("exec", "-T", "vss-catalog", "bun", "-e", script, path, capture=True)
    if p.returncode != 0:
        raise Fail(f"vss-catalog is not reachable (is the stack up?): {p.stderr.strip()[:300]}")
    status, _, body = p.stdout.partition("\n")
    return int(status), body


def load_error() -> str | None:
    """The catalog answers 503 for a model it cannot parse and logs why (the API keeps details out of responses)."""
    p = compose("logs", "--no-log-prefix", "--tail", "50", "vss-catalog", capture=True)
    for line in reversed(p.stdout.splitlines()):
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if entry.get("msg") == "release unavailable":
            return (entry.get("err") or {}).get("message")
    return None


def wait_catalog() -> None:
    p = compose("up", "-d", "--no-build", "--wait", "--wait-timeout", "60", "vss-catalog", capture=True)
    if p.returncode != 0:
        raise Fail(f"vss-catalog did not come back: {p.stderr.strip()[-400:]}")


def cmd_add(release: str, source: Path | None, overlay: Path | None) -> None:
    check_release(release)
    doc = build_document(release, source, overlay)
    with tempfile.TemporaryDirectory(prefix="sv-vss-") as tmp:
        folder = Path(tmp) / release
        folder.mkdir()
        (folder / f"vss_rel_{release[1:]}.json").write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        folder.chmod(0o755)
        p = compose("cp", str(folder), f"vss-catalog:{VOLUME_DIR}/", capture=True)
        if p.returncode != 0:
            raise Fail(f"copy into vss-catalog failed: {p.stderr.strip()[:300]}")
    # The catalog parses a release once per process: restart it so the new or changed model is read.
    compose("restart", "vss-catalog", capture=True)
    wait_catalog()
    status, body = catalog_get(f"/tree?release={release}&depth=1")
    if status != 200:
        raise Fail(f"vss-catalog rejected {release} ({status}): {load_error() or body.strip()[:400]} — fix the file and add it again")
    status, body = catalog_get(f"/model-hash?release={release}")
    print(f"sv vss: {release} added — {json.loads(body).get('modelHash', '?')[:12]}… (catalog)")
    if read_env().get("SV_VSS_CUSTOM_FILE", "").startswith(f"{release}/"):
        compose("up", "-d", "--no-build", "--force-recreate", "databroker-custom", capture=True)
        print(f"sv vss: databroker-custom reloaded {release}")
    else:
        print(f"sv vss: to Run on it, `scripts/sv vss use {release}`; projects pick it in the studio (New project → VSS)")


def cmd_list() -> None:
    status, body = catalog_get("/releases")
    if status != 200:
        raise Fail(f"/releases ⇒ {status}")
    live = read_env().get("SV_VSS_CUSTOM_FILE", "").split("/", 1)[0]
    for r in json.loads(body)["releases"]:
        name = r["release"]
        tags = [t for t, on in (("default", r.get("default")), ("custom", RELEASE.match(name)), ("databroker-custom", name == live)) if on]
        print(f"{name}{'  (' + ', '.join(tags) + ')' if tags else ''}")


def read_env() -> dict[str, str]:
    env: dict[str, str] = {}
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def set_env(values: dict[str, str]) -> None:
    path = ROOT / ".env"
    lines = path.read_text().splitlines() if path.exists() else []
    for key, value in values.items():
        for i, line in enumerate(lines):
            if line.startswith(f"{key}="):
                lines[i] = f"{key}={value}"
                break
        else:
            lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n")


def brokers_with(current: str, release: str | None) -> str:
    """SV_DATABROKERS without any custom entry, plus `release=databroker-custom:55555`."""
    items = [i for i in current.split(",") if i.strip() and not i.strip().endswith(f"={CUSTOM_BROKER}")]
    if release:
        items.append(f"{release}={CUSTOM_BROKER}")
    return ",".join(items)


def profiles_with(current: str, on: bool) -> str:
    items = [p for p in current.split(",") if p.strip() and p.strip() != "vss-custom"]
    return ",".join(items + (["vss-custom"] if on else []))


def cmd_use(release: str) -> None:
    check_release(release)
    status, _ = catalog_get(f"/model-hash?release={release}")
    if status != 200:
        raise Fail(f"{release} is not in the catalog — `scripts/sv vss add {release} …` first")
    env = read_env()
    set_env({
        "COMPOSE_PROFILES": profiles_with(env.get("COMPOSE_PROFILES", ""), True),
        "SV_VSS_CUSTOM_FILE": f"{release}/vss_rel_{release[1:]}.json",
        "SV_DATABROKERS": brokers_with(env.get("SV_DATABROKERS", DEFAULT_BROKERS), release),
    })
    # Only what reads SV_DATABROKERS / runs the custom databroker is recreated, never rebuilt: `up` of the whole stack
    # would rebuild the toolchains' `service:` build contexts and restart them under running jobs.
    running = set(compose("ps", "--services", capture=True).stdout.split())
    services = ["databroker-custom", *(s for s in ("orchestrator", "signal-gateway", "ide-cpp", "ide-python") if s in running)]
    p = compose("up", "-d", "--no-build", "--no-deps", "--wait", "--wait-timeout", "180", *services, capture=True)
    if p.returncode != 0:
        raise Fail(f"restarting {', '.join(services)} failed: {p.stderr.strip()[-400:]}")
    print(f"sv vss: {release} is live on databroker-custom ({', '.join(services)} updated)")


def cmd_remove(release: str) -> None:
    check_release(release)
    p = compose("exec", "-T", "vss-catalog", "rm", "-rf", f"{VOLUME_DIR}/{release}", capture=True)
    if p.returncode != 0:
        raise Fail(f"removing {release} failed: {p.stderr.strip()[:300]}")
    env = read_env()
    if env.get("SV_VSS_CUSTOM_FILE", "").startswith(f"{release}/"):
        set_env({
            "COMPOSE_PROFILES": profiles_with(env.get("COMPOSE_PROFILES", ""), False),
            "SV_VSS_CUSTOM_FILE": "",
            "SV_DATABROKERS": brokers_with(env.get("SV_DATABROKERS", DEFAULT_BROKERS), None),
        })
        compose("stop", "databroker-custom", capture=True)
    compose("restart", "vss-catalog", capture=True)
    wait_catalog()
    print(f"sv vss: {release} removed (projects already on it keep their copy of the file)")


def main(argv: list[str]) -> int:
    try:
        if not argv or argv[0] in {"-h", "--help"}:
            print(__doc__.strip())
            return 0 if argv else 2
        cmd, rest = argv[0], argv[1:]
        if cmd == "list" and not rest:
            cmd_list()
        elif cmd == "add" and len(rest) == 2 and rest[1] != "--overlay":
            cmd_add(rest[0], Path(rest[1]).resolve(), None)
        elif cmd == "add" and len(rest) == 3 and rest[1] == "--overlay":
            cmd_add(rest[0], None, Path(rest[2]).resolve())
        elif cmd == "use" and len(rest) == 1:
            cmd_use(rest[0])
        elif cmd == "remove" and len(rest) == 1:
            cmd_remove(rest[0])
        else:
            print(__doc__.strip(), file=sys.stderr)
            return 2
        return 0
    except Fail as e:
        print(f"sv vss: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

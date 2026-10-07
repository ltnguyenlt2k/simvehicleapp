"""``python3 -m simvehicleapp_runtime.check_project <project>`` — the "build" check of a Python project.

The C++ backend checks at compile time that every signal has the same type in the vehicle model; here the
generated app (``generated/app.py``, imported — so a broken module fails too) is checked against the VSS file
of the project's AppManifest (``vehicle-signal-interface`` ``src``). Exit 1 with one line per problem.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, List, Optional


def vss_file(project: str) -> Optional[str]:
    with open(os.path.join(project, ".velocitas.json"), encoding="utf-8") as f:
        velocitas = json.load(f)
    manifest_path = os.path.join(project, velocitas.get("variables", {}).get("appManifestPath", "app/AppManifest.json"))
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)
    for itf in manifest.get("interfaces", []):
        if itf.get("type") == "vehicle-signal-interface":
            src = itf.get("config", {}).get("src")
            if src and "://" not in src:
                return os.path.join(project, src)
    return None


def leaf(tree: Dict[str, Any], path: str) -> Optional[Dict[str, Any]]:
    parts = path.split(".")
    node = tree.get(parts[0])
    for p in parts[1:]:
        if node is None:
            return None
        node = (node.get("children") or {}).get(p)
    return node if node is not None and node.get("type") != "branch" else None


def problems(signals: Dict[str, str], tree: Dict[str, Any]) -> List[str]:
    out = []
    for path in sorted(signals):
        node = leaf(tree, path)
        if node is None:
            out.append(f"error: {path} is not a signal of the project's VSS (app/src/generated/app.py)")
        elif node.get("datatype") != signals[path]:
            out.append(f"error: {path} is {signals[path]} in the workflows but {node.get('datatype')} in the project's VSS")
    return out


def main(argv: List[str]) -> int:
    project = os.path.abspath(argv[1] if len(argv) > 1 else ".")
    sys.path.insert(0, os.path.join(project, "app", "src"))
    try:
        from generated.app import SIGNALS, WORKFLOWS  # type: ignore
    except Exception as e:  # noqa: BLE001 — any import problem of generated code is a build error
        print(f"error: the generated app does not load: {type(e).__name__}: {e}")
        return 1
    vss = vss_file(project)
    if vss is None or not os.path.exists(vss):
        print("error: the AppManifest names no local VSS file (vehicle-signal-interface src)")
        return 1
    with open(vss, encoding="utf-8") as f:
        tree = json.load(f)
    found = problems(SIGNALS, tree)
    for p in found:
        print(p)
    if not found:
        print(f"[sv] {len(WORKFLOWS)} workflow(s), {len(SIGNALS)} signal(s) match {os.path.relpath(vss, project)}")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

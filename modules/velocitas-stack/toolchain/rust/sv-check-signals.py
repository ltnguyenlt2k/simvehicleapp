#!/usr/bin/env python3
"""The "build" check of a Rust project (ADR-0041): every signal of the generated app (SIGNALS in
app/src/generated/app.rs) exists with the same datatype in the project's VSS (AppManifest src) — the C++
backend checks this at compile time against its vehicle model. Exit 1 with one line per problem."""
import json, os, re, sys

project = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
velocitas = json.load(open(os.path.join(project, ".velocitas.json")))
manifest = json.load(open(os.path.join(project, velocitas.get("variables", {}).get("appManifestPath", "app/AppManifest.json"))))
src = next((i["config"].get("src") for i in manifest.get("interfaces", []) if i.get("type") == "vehicle-signal-interface"), None)
if not src or "://" in src or not os.path.exists(os.path.join(project, src)):
    print("error: the AppManifest names no local VSS file (vehicle-signal-interface src)")
    sys.exit(1)
tree = json.load(open(os.path.join(project, src)))
app = open(os.path.join(project, "app/src/generated/app.rs"), encoding="utf-8").read()
block = re.search(r"pub const SIGNALS: &\[\(&str, &str\)\] = &\[(.*?)\];", app, re.S)
signals = re.findall(r'\("([^"\\]*)", "([^"\\]*)"\)', block.group(1)) if block else []
problems = []
for path, ty in signals:
    node = tree.get(path.split(".")[0])
    for part in path.split(".")[1:]:
        node = (node or {}).get("children", {}).get(part)
    if not node or node.get("type") == "branch":
        problems.append(f"error: {path} is not a signal of the project's VSS (app/src/generated/app.rs)")
    elif node.get("datatype") != ty:
        problems.append(f"error: {path} is {ty} in the workflows but {node.get('datatype')} in the project's VSS")
for p in problems:
    print(p)
if not problems:
    print(f"[sv] {len(signals)} signal(s) match {src}")
sys.exit(1 if problems else 0)

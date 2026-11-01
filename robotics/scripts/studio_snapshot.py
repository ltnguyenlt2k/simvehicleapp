"""Studio snapshot of the RobotFlow block registry + RSS signals (ADR-0068 §2).

Writes runtime/studio-snapshot/rf-registry.json. The studio keeps a committed copy of it (its
apps/sim/blocks/robot/rf-registry.json); the robotics CI fails when the two differ.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from rss import rssc  # noqa: E402

PROFILE = "dog-go2-sim"


def snapshot() -> dict:
    catalog = rssc.build(PROFILE)
    registry = json.loads((ROOT / "robotflow" / "registry.json").read_text())
    nodes = catalog["nodes"]
    blocks = []
    for block in registry["blocks"]:
        props = []
        for prop in block["props"]:
            prop = dict(prop)
            ref = prop.pop("valuesFrom", None)
            if ref:
                path, _, arg = ref.rpartition(".")
                prop["values"] = nodes[path]["args"][arg]["values"]
            signal = prop.get("signal")
            if signal:
                path, _, field = signal.rpartition(".")
                spec = nodes[path]["fields"][field]
                prop["min"], prop["max"] = spec.get("min"), spec.get("max")
            props.append(prop)
        command = block.get("command") or block.get("setpoint")
        pending = nodes.get(command, {}).get("pending") if command else None
        blocks.append({**block, "props": props, **({"pending": pending} if pending else {})})
    signals = [{"path": p, "kind": n["kind"], "type": n.get("type", ""), "unit": n.get("unit", ""),
                "values": n.get("values", []), "description": n["description"]}
               for p, n in catalog["nodes"].items() if n["kind"] in ("sensor", "attribute")]
    return {"schema": "rf-studio-snapshot.v1", "profile": PROFILE, "catalogHash": catalog["catalogHash"],
            "registryVersion": registry["version"], "blocks": blocks, "signals": signals}


if __name__ == "__main__":
    out = ROOT / "runtime" / "studio-snapshot"
    out.mkdir(parents=True, exist_ok=True)
    (out / "rf-registry.json").write_text(json.dumps(snapshot(), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(out / "rf-registry.json")

#!/usr/bin/env python3
"""Block reference of the user guide (M11-T08), generated from the BlockSpecs and their semantics.md.

    python3 scripts/docs/gen_block_reference.py           # writes docs/user-guide/blocks.md
    python3 scripts/docs/gen_block_reference.py --check   # fails when the file is stale (CI)

Deterministic: blocks ordered by category then type; no dates.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BLOCKS = ROOT / "modules/simvehicleapp-core/packages/blocks"
OUT = ROOT / "docs/user-guide/blocks.md"
CATEGORY_ORDER = ["triggers", "sensors", "actuators", "attributes", "logic", "flow", "state", "comm"]


def cell(text) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ")


def semantics(spec_dir: Path) -> str:
    md = spec_dir / "semantics.md"
    if not md.exists():
        return ""
    lines = md.read_text(encoding="utf-8").splitlines()
    body = [l for l in lines[1:] if not l.startswith("Nguồn:")]  # title and source line are replaced here
    text = "\n".join(body).strip()
    # Links are relative to the spec folder; make them relative to docs/user-guide.
    def fix(m):
        target = m.group(2)
        if re.match(r"^[a-z]+:", target) or target.startswith("#"):
            return m.group(0)
        resolved = (spec_dir / target.split("#")[0]).resolve()
        anchor = "#" + target.split("#", 1)[1] if "#" in target else ""
        try:
            rel = Path(*[".."] * 2, resolved.relative_to(ROOT))
        except ValueError:
            return m.group(0)
        return f"[{m.group(1)}]({rel.as_posix()}{anchor})"
    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", fix, text)


def render() -> str:
    specs = []
    for d in sorted(p for p in BLOCKS.iterdir() if (p / "spec.json").exists()):
        specs.append((d, json.loads((d / "spec.json").read_text(encoding="utf-8"))))
    order = {c: i for i, c in enumerate(CATEGORY_ORDER)}
    specs.sort(key=lambda x: (order.get(x[1].get("category"), 99), x[1].get("category", ""), x[1]["type"]))
    out = [
        "# Tham chiếu khối (block reference)",
        "",
        "> Sinh tự động từ `modules/simvehicleapp-core/packages/blocks/*/spec.json` và `semantics.md` bởi",
        "> `scripts/docs/gen_block_reference.py` — không sửa tay. Hướng dẫn bắt đầu: [tutorial.md](tutorial.md).",
        "",
        f"{len(specs)} khối. Biểu thức (`expression`) dùng cú pháp SVX: tham chiếu `<tênkhối.output>` hoặc `<Vehicle.Đường.Dẫn>`,",
        "toán tử ASCII (`== != < <= > >= && || !`), chuỗi trong nháy kép. `template` là văn bản có thể chèn tham chiếu `<…>`.",
        "",
    ]
    category = None
    for d, s in specs:
        if s.get("category") != category:
            category = s.get("category")
            out += [f"## {str(category).capitalize()}", ""]
        out += [f"### {s.get('title', s['type'])} — `{s['type']}`", ""]
        meta = [f"opcode `{s.get('opcode', '-')}`", f"phiên bản {s.get('version', 1)}"]
        handles = s.get("handles") or {}
        if handles:
            meta.append(f"vào [{', '.join(handles.get('in', [])) or '—'}] · ra [{', '.join(handles.get('out', [])) or '—'}]")
        out += [" · ".join(meta), ""]
        props = s.get("props") or []
        if props:
            out += ["| Thuộc tính | Kiểu | Bắt buộc | Mặc định | Giá trị |", "|---|---|---|---|---|"]
            for p in props:
                default = json.dumps(p["default"], ensure_ascii=False) if "default" in p else ""
                enum = ", ".join(json.dumps(e, ensure_ascii=False) for e in p.get("enum", []))
                out.append(f"| `{p['name']}` | {cell(p.get('kind', ''))} | {'có' if p.get('required') else ''} | {cell(default)} | {cell(enum)} |")
            out.append("")
        outputs = s.get("outputs") or []
        if outputs:
            out += ["Đầu ra: " + ", ".join(f"`{o['name']}`" + (f" ({o['type']})" if o.get("type") else "") for o in outputs), ""]
        sem = semantics(d)
        if sem:
            out += [sem, ""]
    return "\n".join(out).rstrip() + "\n"


def main() -> int:
    text = render()
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            print("block reference is stale: run python3 scripts/docs/gen_block_reference.py", file=sys.stderr)
            return 1
        print("block reference up to date")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

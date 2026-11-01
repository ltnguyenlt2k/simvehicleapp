"""Repository boundary guard (ADR-0064): robotics/ and modules/ never reference each other's code."""
import pathlib, re, sys

REPO = pathlib.Path(__file__).resolve().parents[2]
ROBOTICS = REPO / "robotics"
CODE = {".py", ".ts", ".tsx", ".js", ".proto", ".yaml", ".yml", ".toml", ".cfg", ".txt", ".sh"}
FORBIDDEN_IN_ROBOTICS = re.compile(r"(modules/|kuksa|velocitas|vss-tools|simvehicleapp-core)", re.I)
# The repository-root robotics/ folder (relative climbs or bare "robotics/…" specifiers); module-internal folders that
# happen to be named robotics (e.g. the studio's @/lib/sv/robotics adapter) are not cross-module references.
FORBIDDEN_IN_MODULES = re.compile(r"""['"](?:\.\./)+robotics/|['"]robotics/""")


def is_code(path: pathlib.Path) -> bool:
    return path.suffix in CODE or path.name in {"Dockerfile", "sr"} or path.name.endswith(".Dockerfile")


def scan(root: pathlib.Path, pattern: re.Pattern, skip: tuple[str, ...]) -> list[str]:
    hits = []
    for path in root.rglob("*"):
        rel = path.relative_to(REPO).as_posix()
        if not path.is_file() or not is_code(path) or any(part in skip for part in path.parts):
            continue
        if path == pathlib.Path(__file__).resolve():
            continue
        for number, line in enumerate(path.read_text(errors="ignore").splitlines(), 1):
            if pattern.search(line):
                hits.append(f"{rel}:{number}: {line.strip()[:120]}")
    return hits


def main() -> int:
    skip = ("node_modules", "runtime", "__pycache__", ".git", ".next")
    hits = scan(ROBOTICS, FORBIDDEN_IN_ROBOTICS, skip)
    hits += scan(REPO / "modules", FORBIDDEN_IN_MODULES, skip)
    for hit in hits:
        print("BOUNDARY", hit)
    print("precheck:", "FAIL" if hits else "PASS", f"({len(hits)} violation(s))")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())

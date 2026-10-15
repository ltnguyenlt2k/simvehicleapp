#!/usr/bin/env python3
"""Vehicle apps on this host (ADR-0053, M16-T05).

  scripts/sv apps list                    every app: status, size, which workspace links it
  scripts/sv apps prune [--apply] [--e2e] [--failed]

prune removes apps nobody uses, dry-run unless --apply:
  unlinked   no workspace links the app (gates, smoke tests, scripts). Every app a user makes goes through the
             studio and is linked, and the AI/MCP tools only use existing apps, so an unlinked app is never a
             user's.
  archived   only linked from deleted workspaces (what the studio's reconcile does, for every workspace at once).
  failed     with --failed: apps that failed to initialise (the sweeper deletes them after SV_FAILED_TTL_DAYS).
  e2e        with --e2e: apps of the Playwright users (e2e-*@example.com).
  folder     a project folder with no app at all (left by `sv smoke` before it cleaned up, or by an interrupted
             script). Folders changed in the last 30 minutes are left alone: a smoke test may be using them.

Deletion goes through the orchestrator (stops the run, removes the folder, caches and history) and then the
studio link; an orphan folder is removed by the workspace service (folder and its records). A busy app (SynCode
building) is skipped and reported. Talks to the stack with `docker compose exec`,
so it runs from the repository root on the host where `scripts/sv up` runs.
"""
import argparse
import json
import re
import subprocess
import sys

DC = ["docker", "compose"]
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")

# Runs inside the orchestrator container: no port is published, the secret is already in its environment.
ORCHESTRATOR_JS = r"""
const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "" };
const O = "http://127.0.0.1:4030";
const W = process.env.SV_WORKSPACE_URL ?? "http://workspace:4040";
const req = JSON.parse(await Bun.stdin.text());
const out = [];
if (req.op === "list") {
  const { projects } = await (await fetch(`${O}/projects`, { headers: h })).json();
  for (const p of projects) {
    const s = await fetch(`${O}/projects/${p.id}/size`, { headers: h });
    out.push({ id: p.id, slug: p.slug, name: p.name, status: p.status, language: p.language,
               bytes: s.ok ? (await s.json()).bytes : null });
  }
} else if (req.op === "delete-folders") {
  for (const slug of req.slugs) {
    const r = await fetch(`${W}/projects/${slug}`, { method: "DELETE", headers: h });
    out.push({ id: slug, status: r.status, message: r.ok ? "" : (await r.text()).slice(0, 200) });
  }
} else {
  for (const id of req.ids) {
    const r = await fetch(`${O}/projects/${id}`, { method: "DELETE", headers: h });
    out.push({ id, status: r.status, message: r.ok ? "" : (await r.text()).slice(0, 200) });
  }
}
console.log(JSON.stringify(out));
"""

LINKS_SQL = (
    "select p.id, (w.archived_at is not null)::text, coalesce(u.email, '') "
    'from sv_projects p join workspace w on w.id = p.workspace_id left join "user" u on u.id = w.owner_id'
)


def orchestrator(req: dict) -> list:
    r = subprocess.run(
        [*DC, "exec", "-T", "orchestrator", "bun", "-e", ORCHESTRATOR_JS],
        input=json.dumps(req), capture_output=True, text=True,
    )
    if r.returncode != 0:
        sys.exit(f"orchestrator unreachable (is the stack up? scripts/sv up): {r.stderr.strip()[:300]}")
    return json.loads(r.stdout.strip().splitlines()[-1])


def psql(sql: str) -> list[list[str]]:
    r = subprocess.run(
        [*DC, "exec", "-T", "studio-db", "psql", "-U", "postgres", "-d", "simvehicleapp", "-At", "-F", "\t", "-c", sql],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        sys.exit(f"studio database unreachable: {r.stderr.strip()[:300]}")
    return [line.split("\t") for line in r.stdout.splitlines() if line]


def old_folders() -> list[str]:
    """Project folders not changed for 30 minutes, as the workspace service sees them."""
    r = subprocess.run(
        [*DC, "exec", "-T", "workspace", "find", "/workspace/projects", "-mindepth", "1", "-maxdepth", "1",
         "-type", "d", "-mmin", "+30"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        sys.exit(f"workspace unreachable: {r.stderr.strip()[:300]}")
    names = (line.rsplit("/", 1)[-1] for line in r.stdout.splitlines())
    return [n for n in names if SLUG.match(n)]


def folder_sizes(slugs: list[str]) -> list[dict]:
    """Disk usage of folders the workspace service does not know as projects (its /size answers 404 for them)."""
    if not slugs:
        return []
    r = subprocess.run(
        [*DC, "exec", "-T", "workspace", "du", "-sk", *(f"/workspace/projects/{s}" for s in slugs)],
        capture_output=True, text=True,
    )
    sizes = {}
    for line in r.stdout.splitlines():
        kb, path = line.split("\t", 1)
        sizes[path.rsplit("/", 1)[-1]] = int(kb) * 1024
    return [{"slug": s, "bytes": sizes.get(s)} for s in slugs]


def mb(n) -> str:
    return "?" if n is None else f"{n / 1024 ** 2:,.0f} MB"


def classify(apps: list, links: dict, e2e: bool, failed: bool) -> dict:
    """Why each app would be pruned; apps kept are absent."""
    reasons = {}
    for a in apps:
        owners = links.get(a["id"], [])
        if not owners:
            reasons[a["id"]] = "unlinked"
        elif all(archived for archived, _ in owners):
            reasons[a["id"]] = "archived"
        elif e2e and all(email.startswith("e2e-") and email.endswith("@example.com") for _, email in owners):
            reasons[a["id"]] = "e2e"
        elif failed and a["status"] == "failed":
            reasons[a["id"]] = "failed"
    return reasons


def main() -> None:
    ap = argparse.ArgumentParser(prog="sv apps", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["list", "prune"])
    ap.add_argument("--apply", action="store_true", help="delete (default: only show what would be deleted)")
    ap.add_argument("--e2e", action="store_true", help="also apps of the Playwright test users")
    ap.add_argument("--failed", action="store_true", help="also apps that failed to initialise")
    args = ap.parse_args()

    # Folders before apps: an app created in between has no folder in this list, so it is never taken for an orphan.
    folders = old_folders() if args.command == "prune" else []
    apps = orchestrator({"op": "list"})
    links: dict = {}
    for pid, archived, email in psql(LINKS_SQL):
        links.setdefault(pid, []).append((archived == "true", email))
    reasons = classify(apps, links, args.e2e, args.failed)

    if args.command == "list":
        for a in sorted(apps, key=lambda a: a["slug"]):
            owners = ", ".join(e or "?" for _, e in links.get(a["id"], [])) or "-"
            print(f"{a['slug']:<40} {a['status']:<8} {a['language']:<7} {mb(a['bytes']):>9}  {owners}")
        total = sum(a["bytes"] or 0 for a in apps)
        print(f"{len(apps)} apps, {mb(total)}")
        return

    doomed = [a for a in apps if a["id"] in reasons]
    slugs = {a["slug"] for a in apps}
    orphans = folder_sizes([f for f in folders if f not in slugs])
    for a in sorted(doomed, key=lambda a: (reasons[a["id"]], a["slug"])):
        print(f"{reasons[a['id']]:<9} {a['slug']:<40} {a['status']:<8} {mb(a['bytes']):>9}")
    for o in orphans:
        print(f"{'folder':<9} {o['slug']:<40} {'-':<8} {mb(o['bytes']):>9}")
    total = sum(a["bytes"] or 0 for a in doomed) + sum(o["bytes"] or 0 for o in orphans)
    print(
        f"{len(doomed)} of {len(apps)} apps and {len(orphans)} orphan folders, {mb(total)}"
        " (folders; their build caches come on top and are removed by the next sweep)"
    )
    if not args.apply:
        print("dry run: add --apply to delete")
        return
    if orphans:
        for r in orchestrator({"op": "delete-folders", "slugs": [o["slug"] for o in orphans]}):
            if r["status"] not in (204, 404):
                print(f"skipped folder {r['id']}: {r['status']} {r['message']}", file=sys.stderr)
    if not doomed:
        return
    results = orchestrator({"op": "delete", "ids": [a["id"] for a in doomed]})
    gone = [r["id"] for r in results if r["status"] in (204, 404)]
    for r in results:
        if r["status"] not in (204, 404):
            print(f"skipped {r['id']}: {r['status']} {r['message']}", file=sys.stderr)
    linked = [i for i in gone if i in links]
    if linked:
        ids = ",".join("'" + i.replace("'", "") + "'" for i in linked)
        psql(f"delete from sv_projects where id in ({ids})")
    freed = sum(a["bytes"] or 0 for a in doomed if a["id"] in gone)
    print(f"deleted {len(gone)} apps, {mb(freed)} freed; {len(results) - len(gone)} skipped")


if __name__ == "__main__":
    main()

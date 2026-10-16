#!/usr/bin/env python3
"""Runs on this host (ADR-0057, M17-T05).

  scripts/sv runs list            apps running now: run id, app, owner, VSS release, state, sandbox, time left
  scripts/sv runs stop <run-id>   stop one run (admin: stopReason admin)
  scripts/sv runs stop --all      stop every active run (before maintenance)

Talks to the orchestrator with `docker compose exec`, so it runs from the repository root on the host where
`scripts/sv up` runs. The limits in force are printed with the list (SV_RUN_SANDBOX, quotas, time limit).
"""
import argparse
import json
import subprocess
import sys
import time

ORCHESTRATOR_JS = r"""
const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "", "content-type": "application/json" };
const O = "http://127.0.0.1:4030";
const req = JSON.parse(await Bun.stdin.text());
const { runs, limits } = await (await fetch(`${O}/runs?active=true`, { headers: h })).json();
const { projects } = await (await fetch(`${O}/projects`, { headers: h })).json();
const name = Object.fromEntries(projects.map((p) => [p.id, p.slug]));
if (req.op === "list") {
  console.log(JSON.stringify({ limits, runs: runs.map((r) => ({ ...r, app: name[r.projectId] ?? r.projectId })) }));
} else {
  const ids = req.all ? runs.map((r) => r.id) : [req.id];
  const out = [];
  for (const id of ids) {
    const r = await fetch(`${O}/runs/${encodeURIComponent(id)}/stop`, { method: "POST", headers: h, body: JSON.stringify({ reason: "admin" }) });
    out.push({ id, status: r.status });
  }
  console.log(JSON.stringify({ stopped: out }));
}
"""


def orchestrator(req: dict) -> dict:
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "orchestrator", "bun", "-e", ORCHESTRATOR_JS],
        input=json.dumps(req), capture_output=True, text=True,
    )
    if out.returncode != 0:
        sys.exit(f"sv runs: the orchestrator did not answer ({out.stderr.strip()[:300]})")
    return json.loads(out.stdout.strip().splitlines()[-1])


def left(expires_at) -> str:
    if not expires_at:
        return "-"
    s = max(0, int(expires_at / 1000 - time.time()))
    return f"{s // 60} min" if s >= 60 else f"{s} s"


def main() -> None:
    ap = argparse.ArgumentParser(prog="sv runs", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    stop = sub.add_parser("stop")
    stop.add_argument("id", nargs="?")
    stop.add_argument("--all", action="store_true")
    a = ap.parse_args()
    if a.cmd == "list":
        r = orchestrator({"op": "list"})
        l = r.get("limits") or {}
        mode = (f"sandboxes on: {l.get('perUser')} per user, {l.get('total')} on the host, "
                f"{l.get('maxMinutes') or 'no'} min limit, {l.get('maxExtensions')} extensions") if l.get("sandbox") else "shared stack: one run at a time"
        print(f"{len(r['runs'])} active run(s) — {mode}")
        for x in r["runs"]:
            owner = (x.get("owner") or {}).get("userId", "-")
            print(f"  {x['id']:<40} {x['app']:<28} {owner:<24} {x['vssRelease']:<8} {x['state']:<9} {x.get('sandbox', 'shared'):<22} {left(x.get('expiresAt'))}")
        return
    if not a.all and not a.id:
        sys.exit("sv runs stop: give a run id or --all")
    r = orchestrator({"op": "stop", "all": a.all, "id": a.id})
    for s in r["stopped"]:
        state = "stopping" if s["status"] == 200 else f"HTTP {s['status']}"
        print(f"  {s['id']}: {state}")


if __name__ == "__main__":
    main()

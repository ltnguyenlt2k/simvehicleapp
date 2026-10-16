# shellcheck shell=bash
# Sourced by gates, smoke tests and evals that create vehicle apps (ADR-0053 §B, M16-T05): they delete what they made
# when they exit, pass or fail, so a dev or CI host does not fill up with test apps.
#   source scripts/lib/sv-apps.sh; trap 'sv_delete_apps "$SLUG"' EXIT
# SV_KEEP_APPS=1 keeps them (to look at a failure). Exact slugs only: never a pattern, so a run in parallel or a
# user's app is never touched. Deletion goes through the orchestrator (run stopped, folder, caches, history).
sv_delete_apps() {
  (($#)) || return 0
  if [[ "${SV_KEEP_APPS:-}" == 1 ]]; then
    echo "sv: keeping $* (SV_KEEP_APPS=1)"
    return 0
  fi
  SV_SLUGS="$*" docker compose exec -T -e SV_SLUGS orchestrator bun -e '
    const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "" };
    const want = new Set((process.env.SV_SLUGS ?? "").split(" ").filter(Boolean));
    const { projects } = await (await fetch("http://127.0.0.1:4030/projects", { headers: h })).json();
    for (const p of projects.filter((p) => want.has(p.slug))) {
      const r = await fetch(`http://127.0.0.1:4030/projects/${p.id}`, { method: "DELETE", headers: h });
      console.log(`sv: ${r.ok ? "deleted" : `could not delete (${r.status})`} app ${p.slug}`);
    }' || echo "sv: could not delete $* (scripts/sv apps prune removes them later)"
}

# Stops the active runs of the given apps (exact slugs), e.g. `trap 'sv_stop_runs "$SLUG"' EXIT` in a gate that runs
# an app (ADR-0057): with sandboxes a forgotten run keeps its databroker and app until its time limit.
sv_stop_runs() {
  (($#)) || return 0
  SV_SLUGS="$*" docker compose exec -T -e SV_SLUGS orchestrator bun -e '
    const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "" };
    const want = new Set((process.env.SV_SLUGS ?? "").split(" ").filter(Boolean));
    const { projects } = await (await fetch("http://127.0.0.1:4030/projects", { headers: h })).json();
    for (const p of projects.filter((p) => want.has(p.slug))) {
      const { runs } = await (await fetch(`http://127.0.0.1:4030/runs?projectId=${p.id}&active=true`, { headers: h })).json();
      for (const r of runs) {
        const s = await fetch(`http://127.0.0.1:4030/runs/${r.id}/stop`, { method: "POST", headers: h });
        console.log(`sv: ${s.ok ? "stopped" : `could not stop (${s.status})`} run ${r.id} of ${p.slug}`);
      }
    }' || echo "sv: could not stop the runs of $*"
}

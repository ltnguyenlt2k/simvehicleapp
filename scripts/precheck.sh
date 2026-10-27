#!/usr/bin/env bash
# The CI "repo checks" and the diagnostics guard, locally, before a push (M21 lesson: two red CI runs were checks that
# run in seconds here — a stale block reference and a changed diagnostic severity).
#   scripts/sv precheck            against origin/main
set -uo pipefail
cd "$(dirname "$0")/.."
BASE="${1:-$(git rev-parse origin/main)}"
fail=0
run() { local name=$1; shift; if out=$("$@" 2>&1); then echo "ok   $name"; else echo "FAIL $name"; echo "$out" | tail -5; fail=1; fi; }
run "ci self-test" python3 -m unittest discover -s scripts/ci/tests
run "compose lint" python3 scripts/ci/compose_lint.py
run "image groups" python3 scripts/ci/image_groups.py
run "block reference" python3 scripts/docs/gen_block_reference.py --check
run "contract-only deps" python3 scripts/ci/contract_only_deps.py
run "block specs snapshot" python3 scripts/ci/block_specs_sync.py
run "golden copies" python3 scripts/ci/golden_sync.py
run "studio guards" python3 scripts/ci/studio_guards.py
run "scratch denylist" python3 scripts/ci/scratch_denylist.py
run "diagnostics guard ($BASE)" python3 scripts/ci/diagnostics_guard.py --base "$BASE"
run "Sim fork tree" python3 scripts/upstream_tree_check.py --repo simstudioai/sim --commit ad0b8678b5dc4b6d5703481d567f29c9facc6f67 \
  --path modules/simvehicleapp-studio --allow modules/simvehicleapp-studio/UPSTREAM_SYNC.allow
exit $fail

# CI checks (M00-T08)

Run by `.github/workflows/ci.yml`; all are plain Python 3 (stdlib only) and runnable locally from the repo root:

| Check | Command | Rule |
|---|---|---|
| compose lint | `python3 scripts/ci/compose_lint.py` | root + each `modules/*/compose*.yaml` valid standalone, include list complete, no `docker.sock`, ports bind `127.0.0.1`, build contexts/binds inside the module (ADR-0005, ADR-0009) |
| contract-only-deps | `python3 scripts/ci/contract_only_deps.py` | cross-module deps/imports only to `simvehicleapp-contracts` (AGENTS §2.2) |
| license scan | `scripts/license/scan.sh` (after `bun install --frozen-lockfile` in each scanned module) | whitelist/denylist/exceptions, forbidden IDE extensions (ADR-0004, AGENTS §2.4) |
| self-test | `python3 -m unittest discover -s scripts/ci/tests` | every rule rejects a violating fixture and accepts a compliant one |

`ci.env` holds dummy values for compose variables declared `:?required`; it is never used at runtime.
| vendored trees | `python3 scripts/upstream_tree_check.py --repo … --commit … --path … [--allow …]` | Sim snapshot and Velocitas templates match their pinned upstream trees; studio changes must be declared in `modules/simvehicleapp-studio/UPSTREAM_SYNC.allow` (ADR-0003, ADR-0008) |
| studio guards | `python3 scripts/ci/studio_guards.py` | no `apps/sim/ee` path and no `@/ee/` reference in the studio (ADR-0004, M01-T02c; Scratch denylist added in M01-T11) |

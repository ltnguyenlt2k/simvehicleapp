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
| Scratch denylist | `python3 scripts/ci/scratch_denylist.py` | no string literal in SimVehicleApp-owned code equals a Scratch opcode name (`analysis/adr/scratch-opcode-denylist.grep`, ADR-0004, M01-T11) |

## Job selection and runner budget (2026-10-13)

The repository is private (GitHub Actions: 2 vCPU / 7 GB RAM runners, billed minutes, 500 MB artifact storage), so
`.github/workflows/ci.yml` runs only what a change can affect:

| Piece | What it does |
|---|---|
| `changes` job → `scripts/ci/changes.py` | diffs HEAD against the last commit whose CI run fully succeeded (PR: its base) and prints which jobs run; table `RULES` maps path prefixes to jobs (contracts ⇒ every module; core ⇒ core + its images + studio E2E; docs ⇒ none). CI files or an unknown base ⇒ every job. Tested in `tests/test_ci_checks.py` (`Changes`). |
| `repo checks` | the seconds-long repo-wide checks above in **one** job (each job is billed at least one minute). Always runs. |
| license scan, osv-scanner | only when a dependency manifest changes (`bun.lock`, `package.json`, `requirements.txt`, `Cargo.*`, `conanfile.*`); osv also runs every night (`nightly.yml`) for newly published advisories. |
| macOS determinism | only when the C++ backend or contracts change (macOS minutes cost 10×). |
| studio image | `docker/build-push-action` with the Actions layer cache (`type=gha`): the dependency stage (bun install + isolated-vm) is rebuilt only when manifests change; swap sized from the free disk. Only the newest `studio-image` artifact is kept; `scripts/sv refresh` reuses it when a push did not touch the studio. |

#!/usr/bin/env bash
# Bring the local dev stack to the latest pushed commit so it can be previewed at any time.
#   scripts/sv refresh            use the CI run of HEAD (waits for it if still running)
#   scripts/sv refresh --latest   use the newest main run that has a studio image
#
# The studio image cannot be built on small hosts, so it comes from CI (artifact `studio-image`, kept
# 3 days); contracts and core images are small and are built locally. Containers are recreated with
# `docker compose up -d` — volumes (studio DB, workspace, caches) are NEVER removed here.
set -euo pipefail
cd "$(dirname "$0")/.."
DC="docker compose"
# Version info of every service (/version, System status): the checked-out commit.
export SV_COMMIT="${SV_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)

has_studio_image() {
  gh api "repos/$REPO/actions/runs/$1/artifacts" \
    --jq '[.artifacts[] | select(.name == "studio-image" and .expired == false)] | length'
}

if [[ "${1:-}" == "--latest" ]]; then
  run=""
  for r in $(gh run list --branch main --limit 15 --json databaseId --jq '.[].databaseId'); do
    if [[ "$(has_studio_image "$r")" == 1 ]]; then run=$r; break; fi
  done
  [[ -n "$run" ]] || { echo "refresh: no main run with a studio image in the last 15 runs" >&2; exit 1; }
else
  sha=$(git rev-parse HEAD)
  if [[ "$(git rev-parse '@{u}' 2>/dev/null || true)" != "$sha" ]]; then
    echo "refresh: HEAD $sha is not pushed yet — push first (CI builds the studio image)" >&2
    exit 1
  fi
  run=$(gh run list --branch main --commit "$sha" --limit 1 --json databaseId --jq '.[0].databaseId // empty')
  [[ -n "$run" ]] || { echo "refresh: no CI run for $sha yet — retry in a minute" >&2; exit 1; }
  echo "refresh: waiting for CI run $run ($sha)…"
  gh run watch "$run" --exit-status >/dev/null || true
  if [[ "$(has_studio_image "$run")" != 1 ]]; then
    echo "refresh: run $run produced no studio image (job failed or cancelled):" >&2
    gh run view "$run" --json jobs --jq '.jobs[] | select(.conclusion != "success") | "  " + .conclusion + "  " + .name' >&2
    exit 1
  fi
fi

run_sha=$(gh run view "$run" --json headSha --jq .headSha)
marker="simvehicleapp/studio:sha-${run_sha:0:12}"
if docker image inspect "$marker" >/dev/null 2>&1; then
  echo "refresh: studio image of ${run_sha:0:12} already loaded"
  docker tag "$marker" simvehicleapp/studio:dev
else
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/sv-refresh.XXXXXX")
  trap 'rm -rf "$tmp"' EXIT
  artifact=$(gh api "repos/$REPO/actions/runs/$run/artifacts" \
    --jq '.artifacts[] | select(.name == "studio-image" and .expired == false) | .id')
  echo "refresh: downloading studio image of ${run_sha:0:12} from run $run (~700 MB, parallel ranges)…"
  python3 scripts/fetch_artifact.py --repo "$REPO" --artifact "$artifact" --out "$tmp/a.zip" --extract "$tmp"
  docker load -i "$tmp/studio-image.tar.gz"
  docker tag simvehicleapp/studio:dev "$marker"
fi

echo "refresh: building migrations/realtime, contracts, core, backend, orchestration and toolchain-agent images…"
# Small images built from source: DB migrations (new Drizzle migrations), realtime, contracts, core,
# the orchestration services, and the toolchain image (only its agent layer rebuilds; the C++ toolchain
# layers come from the cache). ide-cpp is not rebuilt: it does not run the agent.
$DC build studio-migrations studio-realtime
$DC build contracts
$DC build vss-catalog compiler codegen-cpp
$DC build orchestrator workspace signal-gateway toolchain-cpp ai-assistant
# Python backend when the `python` profile is on (ADR-0040): only its agent layer rebuilds, like toolchain-cpp.
if $DC config --services | grep -qx toolchain-python; then $DC build codegen-python toolchain-python; fi
if $DC config --services | grep -qx toolchain-rust; then $DC build codegen-rust toolchain-rust; fi
# Toolchains first: they seed the volumes the IDEs share (concurrent first mounts race on the copy-up).
$DC up -d $($DC config --services | grep -x 'toolchain-[a-z]*' | tr '\n' ' ')
$DC up -d
# Keep the running studio image and the previous one (rollback); older sha-* tags are ~2 GB each.
# Only image tags are removed — never containers or volumes.
mapfile -t old_tags < <(docker images simvehicleapp/studio --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' \
  | grep ':sha-' | sort -r | cut -f2 | grep -vx "$marker" | tail -n +2)
if ((${#old_tags[@]})); then
  echo "refresh: removing ${#old_tags[@]} old studio image tag(s)"
  docker image rm "${old_tags[@]}" >/dev/null 2>&1 || true
fi
echo "refresh: stack is on ${run_sha:0:12}"
$DC ps --format '{{.Service}}\t{{.Status}}'

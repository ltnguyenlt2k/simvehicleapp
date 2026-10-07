#!/usr/bin/env bash
# Release split (ADR-0009 §5, M11-T10): every modules/<m> becomes its own repository with its history
# (`git subtree split --prefix modules/<m>`), then the meta-repo pins them (submodules + lock, ADR-0002).
#
#   scripts/release-split.sh                       dry run: split every module in a scratch clone, report SHAs
#   scripts/release-split.sh --push <git-base-url> push each split to <git-base-url>/<m>.git (branch main)
#
# Never rewrites this repository: the split runs in a temporary clone. Pushing is outward-facing and only
# happens with --push (the release step, confirmed by the PO).
set -euo pipefail
cd "$(dirname "$0")/.."
push=""; [[ "${1:-}" == "--push" ]] && push="${2:?usage: --push <git-base-url>}"
work=$(mktemp -d "${TMPDIR:-/tmp}/sv-split.XXXXXX")
trap 'rm -rf "$work"' EXIT
git clone -q --no-local . "$work/repo"
cd "$work/repo"
printf "%-28s %-12s %8s  %s\n" module split commits tree-check
for dir in modules/*/; do
  m=$(basename "$dir")
  sha=$(git subtree split -q --prefix "modules/$m" -b "split/$m")
  n=$(git rev-list --count "split/$m")
  # The split's root tree must be exactly the module folder at HEAD.
  same=$([[ "$(git rev-parse "split/$m^{tree}")" == "$(git rev-parse "HEAD:modules/$m")" ]] && echo ok || echo MISMATCH)
  printf "%-28s %-12s %8s  %s\n" "$m" "${sha:0:12}" "$n" "$same"
  [[ "$same" == ok ]] || exit 1
  if [[ -n "$push" ]]; then git push -q "$push/$m.git" "split/$m:main"; fi
done
[[ -n "$push" ]] && echo "pushed to $push/<module>.git" || echo "dry run: nothing pushed"

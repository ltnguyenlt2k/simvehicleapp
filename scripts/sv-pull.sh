#!/usr/bin/env bash
# sv pull — load the prebuilt images of a GitHub Release instead of building them (ADR-0051, low-spec hosts).
#   scripts/sv pull [<tag>] [--groups core,studio,cpp]
# <tag>: a release with image assets (default: the newest one). Groups (deploy/image-groups.txt): default
# core,studio,cpp plus python/rust when COMPOSE_PROFILES in .env enables them. Each group is checked against its
# sha256 manifest before `docker load`; afterwards SV_PREBUILT=<tag> in .env makes `sv up` start with --no-build.
# Needs: gh (authenticated for the repository), zstd, ~2 GB free for the download (removed after loading).
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="${SV_REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
tag="" groups=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --groups) groups="$2"; shift 2 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) tag="$1"; shift ;;
  esac
done
command -v zstd >/dev/null || { echo "sv pull: zstd is required (apt install zstd)" >&2; exit 2; }

if [[ -z "$tag" ]]; then
  # Newest release that has image assets (a release without them predates ADR-0051 or is still building).
  for t in $(gh release list -R "$REPO" -L 20 --json tagName --jq '.[].tagName'); do
    if gh release view "$t" -R "$REPO" --json assets --jq '.assets[].name' | grep -q '^images-core\.sha256$'; then tag="$t"; break; fi
  done
  [[ -n "$tag" ]] || { echo "sv pull: no release with image assets in $REPO" >&2; exit 1; }
fi
if [[ -z "$groups" ]]; then
  groups="core,studio,cpp"
  profiles="$(sed -n 's/^COMPOSE_PROFILES=//p' .env 2>/dev/null || true)"
  [[ ",$profiles," == *",python,"* ]] && groups+=",python"
  [[ ",$profiles," == *",rust,"* ]] && groups+=",rust"
fi

# The compose files must be the ones the images were built with.
tag_sha="$(git rev-parse -q --verify "refs/tags/$tag^{commit}" 2>/dev/null || true)"
if [[ "$tag_sha" != "$(git rev-parse HEAD)" ]]; then
  echo "sv pull: warning — HEAD is not $tag; run 'git fetch --tags && git checkout $tag' so compose matches the images" >&2
fi

tmp="$(mktemp -d "${TMPDIR:-/tmp}/sv-pull.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
for g in ${groups//,/ }; do
  grep -qE "^$g[[:space:]]" deploy/image-groups.txt || { echo "sv pull: unknown group $g" >&2; exit 2; }
  echo "sv pull: $tag / $g"
  gh release download "$tag" -R "$REPO" -D "$tmp" -p "images-$g.*" --clobber
  (cd "$tmp" && sha256sum --quiet -c "images-$g.sha256")
  # One part unless the group exceeds the 2 GiB asset limit (split by the release workflow).
  cat "$tmp"/images-"$g".tar.zst* | zstd -dc | docker load
  rm -f "$tmp"/images-"$g".*
done

touch .env
if grep -q '^SV_PREBUILT=' .env; then sed -i "s/^SV_PREBUILT=.*/SV_PREBUILT=$tag/" .env; else echo "SV_PREBUILT=$tag" >> .env; fi
echo "sv pull: loaded $groups from $tag — 'scripts/sv up' now starts without building (SV_PREBUILT=$tag in .env)"

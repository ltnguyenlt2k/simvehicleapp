#!/usr/bin/env bash
# Clean machine → running SimVehicleApp (exit checklist v1.0: UI < 30 min the first time, < 2 min after).
#   scripts/bootstrap.sh            check prerequisites, create .env, build images, start, wait until healthy
#   scripts/bootstrap.sh --no-build start with the images already present (second run)
# Never removes volumes. Ports are bound to 127.0.0.1 only.
set -euo pipefail
cd "$(dirname "$0")/.."
t0=$(date +%s)
say() { printf '\033[1mbootstrap:\033[0m %s\n' "$*"; }
die() { say "$*" >&2; exit 1; }

# 1. prerequisites
command -v docker >/dev/null || die "Docker is required (https://docs.docker.com/engine/install/)"
docker info >/dev/null 2>&1 || die "the Docker daemon is not reachable (is it running, is your user in the docker group?)"
v=$(docker compose version --short 2>/dev/null || true)
[[ -n "$v" ]] || die "Docker Compose v2 is required (docker compose)"
IFS=. read -r ma mi _ <<<"${v#v}"
(( ma > 2 || (ma == 2 && mi >= 24) )) || die "Docker Compose >= 2.24 is required (include + additional_contexts), found $v"
command -v git >/dev/null || die "git is required"
command -v python3 >/dev/null || die "python3 is required (scripts)"
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
(( mem_kb >= 7500000 )) || say "warning: $((mem_kb / 1024 / 1024)) GB RAM — 8 GB or more is recommended (the studio image build needs the most)"
free_gb=$(df -Pk . | awk 'NR==2 {print int($4 / 1024 / 1024)}')
(( free_gb >= 30 )) || say "warning: ${free_gb} GB free disk — about 30 GB is needed for the images and build caches"

# 2. configuration
scripts/sv init

# 3. images
if [[ "${1:-}" != "--no-build" ]]; then
  say "building images (first run: 15–30 min; the toolchain bakes the Velocitas/Conan caches)…"
  scripts/sv build
fi

# 4. start and wait until every service with a healthcheck is healthy
scripts/sv up
say "waiting for the services…"
for _ in $(seq 1 120); do
  starting=$(docker compose ps --format '{{.Health}}' | grep -c -E 'starting|unhealthy' || true)
  [[ "$starting" == 0 ]] && break
  sleep 5
done
docker compose ps --format '{{.Service}}\t{{.Status}}' | sort
unhealthy=$(docker compose ps --format '{{.Service}} {{.Health}}' | awk '$2 == "unhealthy" || $2 == "starting" {print $1}')
[[ -z "$unhealthy" ]] || die "not healthy: $unhealthy — see docker compose logs <service>"
url=$(sed -n 's/^SV_STUDIO_URL=//p' .env | head -1)
say "ready in $(( $(date +%s) - t0 )) s — open ${url:-http://localhost:3000} (tutorial: docs/user-guide/tutorial.md)"

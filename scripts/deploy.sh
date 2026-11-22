#!/usr/bin/env bash
# Deploys UptimeHQ on the server. Run from anywhere inside the repository on the VM.
# Called by the GitHub Actions "deploy" job over SSH, and safe to run by hand.
#
#   bash scripts/deploy.sh                       # deploy the latest main
#   DEPLOY_SHA=<commit> bash scripts/deploy.sh   # deploy (or roll back to) a specific commit
#
# Two modes, chosen by IMAGE_REGISTRY in .env:
#   set   (e.g. ghcr.io/ashutosh-lodha/)  pull the images CI built and tagged with the commit SHA
#   empty                                 build the images on this machine
#
# Secrets stay in .env (git-ignored). The only line this script changes there is IMAGE_TAG,
# which records the deployed commit so restarts and manual `docker compose` use the same images.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"

# Run from a temporary copy: checking out another commit may rewrite this very file.
if [ -z "${DEPLOY_REEXEC:-}" ]; then
  tmp="$(mktemp)"
  cp "$0" "$tmp"
  DEPLOY_REEXEC=1 DEPLOY_REPO="$repo" exec bash "$tmp" "$@"
fi
trap 'rm -f "$0"' EXIT
cd "$DEPLOY_REPO"

if [ ! -f .env ]; then
  echo "error: .env is missing. Create it from .env.example first." >&2
  exit 1
fi

env_value() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
set_env() {
  if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}

echo "==> Fetching code"
git fetch --prune origin main
target="${DEPLOY_SHA:-$(git rev-parse origin/main)}"
git reset --hard "$target"
echo "    at $(git log -1 --format='%h %s')"

registry="$(env_value IMAGE_REGISTRY)"
previous="$(env_value IMAGE_TAG)"
if [ -n "$registry" ]; then
  echo "==> Pulling images ${registry}uptimehq-{backend,frontend}:$target"
  set_env IMAGE_TAG "$target"
  if ! docker compose pull api frontend; then
    echo "error: images for $target are not in the registry (has CI finished publishing them?)" >&2
    if [ -n "$previous" ]; then set_env IMAGE_TAG "$previous"; else sed -i '/^IMAGE_TAG=/d' .env; fi
    exit 1
  fi
  # The test lab only copies files, so it is built here. Commits from before it have no such service.
  if grep -q '^  testlab:' docker-compose.yml; then
    echo "==> Building the test lab"
    docker compose build testlab
  fi
  echo "==> Starting containers"
  docker compose up -d --no-build --remove-orphans
else
  echo "==> Building images on this machine (IMAGE_REGISTRY is not set)"
  docker compose up -d --build --remove-orphans
fi

# NGINX reads its config from mounted files, so a config-only change does not recreate it.
# Recreate it whenever the config (or the .env values that select it) differs from the last deploy.
nginx_hash="$({ cat nginx/*; env_value NGINX_CONF; env_value DOMAIN; } | sha256sum | cut -c1-16)"
if [ "$(env_value NGINX_CONFIG_HASH)" != "$nginx_hash" ]; then
  echo "==> NGINX config changed: recreating nginx"
  docker compose up -d --no-deps --force-recreate nginx
  set_env NGINX_CONFIG_HASH "$nginx_hash"
fi

echo "==> Waiting for services to become healthy"
deadline=$((SECONDS + 300))
while true; do
  unhealthy=$(docker compose ps --format '{{.Service}} {{.Health}}' | awk '$2 != "healthy" {print $1}')
  if [ -z "$unhealthy" ]; then
    echo "    all services healthy"
    break
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "error: not healthy after 5 minutes: $unhealthy" >&2
    docker compose ps
    # shellcheck disable=SC2086 # intentional: one argument per unhealthy service
    docker compose logs --tail=50 $unhealthy || true
    exit 1
  fi
  sleep 5
done

echo "==> Removing unused images"
docker image prune -f >/dev/null

docker compose ps
echo "==> Deployed $(git log -1 --format='%h')"

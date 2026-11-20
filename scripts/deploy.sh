#!/usr/bin/env bash
# Deploys the latest main branch on the server. Run from the repository root on the VM.
# Called by the GitHub Actions "deploy" job over SSH, and safe to run by hand.
#
#   bash scripts/deploy.sh
#
# Secrets stay in .env (git-ignored); this script never touches it.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "error: .env is missing. Create it from .env.example first." >&2
  exit 1
fi

echo "==> Fetching latest code"
git fetch --prune origin main
git reset --hard origin/main
echo "    now at $(git log -1 --format='%h %s')"

echo "==> Building and starting containers"
docker compose up -d --build --remove-orphans

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

echo "==> Removing dangling images"
docker image prune -f >/dev/null

docker compose ps
echo "==> Deployed $(git log -1 --format='%h')"

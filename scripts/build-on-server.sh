#!/usr/bin/env bash
#
# Build the CRM image on the Nuremberg host itself (no GitHub Actions, no
# registry). Sends a clean `git archive` of the commit as the build context.
#
#   bash scripts/build-on-server.sh            # origin/main
#   bash scripts/build-on-server.sh <sha|ref>
#
# Tags ghcr.io/glaura-ai/glaura-crm:latest (what docker-compose.yml runs) and
# :sha-<full sha> (for rollback). Deploy afterwards WITHOUT `docker compose pull`,
# which would replace the local build with the old GHCR image.
set -euo pipefail

HOST="${CRM_HOST:-root@188.245.250.151}"
IMAGE="ghcr.io/glaura-ai/glaura-crm"

git fetch -q origin
SHA="$(git rev-parse --verify "${1:-origin/main}^{commit}")"
echo "==> Building ${IMAGE}:sha-${SHA} on ${HOST}"

git archive "${SHA}" | ssh "${HOST}" "docker build --quiet \
  --label org.opencontainers.image.revision=${SHA} \
  --label org.opencontainers.image.source=https://github.com/glaura-ai/glaura-crm \
  -t ${IMAGE}:latest -t ${IMAGE}:sha-${SHA} -"

echo "==> Built ${IMAGE}:latest = sha-${SHA}"

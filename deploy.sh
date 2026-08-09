#!/usr/bin/env bash
# Deploy Luna Guide to the VPS (luna.dpiecha.de).
set -euo pipefail
cd "$(dirname "$0")"

SSH_TARGET="dennis@dpiecha.de"
REMOTE_PATH="/home/dennis/luna-guide"
SITE="https://luna.dpiecha.de"

echo "==> Local typecheck + build"
npm run build

echo "==> Rsync to ${SSH_TARGET}:${REMOTE_PATH}"
rsync -az --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude dist \
  ./ "${SSH_TARGET}:${REMOTE_PATH}/"

echo "==> Rebuild container"
ssh "${SSH_TARGET}" "cd ${REMOTE_PATH} && docker compose up -d --build"

echo "==> Verify"
sleep 3
code=$(curl -s -o /dev/null -w '%{http_code}' "${SITE}/")
echo "GET ${SITE}/ -> ${code}"
[ "${code}" = "200" ] || { echo "Deployment verification failed"; exit 1; }
echo "OK"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_STUDYCLAW="${HOME}/studyclaw"
TARGET_OPENCLAW="${HOME}/.openclaw"

mkdir -p "${TARGET_STUDYCLAW}" "${TARGET_OPENCLAW}"

rsync -a --delete "${ROOT_DIR}/studyclaw/" "${TARGET_STUDYCLAW}/"
rsync -a "${ROOT_DIR}/openclaw-home/" "${TARGET_OPENCLAW}/"

echo "Restored StudyClaw to ${TARGET_STUDYCLAW}"
echo "Restored OpenClaw home to ${TARGET_OPENCLAW}"
echo "Next: install dependencies, verify .env values, and start the services."

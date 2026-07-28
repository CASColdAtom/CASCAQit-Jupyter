#!/usr/bin/env bash
set -euo pipefail

readonly PORT=8888
readonly LOG_FILE="/tmp/cascaqit-jupyterlab.log"

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if jupyter server list 2>/dev/null | grep -q ":${PORT}/"; then
  echo "CASCAQit JupyterLab is already running on port ${PORT}."
  jupyter server list
  exit 0
fi

nohup jupyter lab \
  --ip=0.0.0.0 \
  --port="${PORT}" \
  --no-browser \
  --ServerApp.port_retries=0 \
  --ServerApp.root_dir="${repo_dir}" \
  >"${LOG_FILE}" 2>&1 &
server_pid=$!

for _ in $(seq 1 30); do
  if jupyter server list 2>/dev/null | grep -q ":${PORT}/"; then
    echo "CASCAQit JupyterLab is ready on port ${PORT}."
    jupyter server list
    exit 0
  fi
  if ! kill -0 "${server_pid}" 2>/dev/null; then
    break
  fi
  sleep 1
done

echo "JupyterLab did not start. Recent log output:" >&2
tail -n 80 "${LOG_FILE}" >&2
exit 1

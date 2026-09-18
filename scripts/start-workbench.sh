#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_venv="${CASCAQIT_JUPYTER_VENV:-$repo_dir/.venv}"
export PATH="$runtime_venv/bin:$PATH"
if [ -z "${CASCAQIT_CODE_SERVER:-}" ]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) platform=macos-arm64 ;;
    Darwin-x86_64) platform=macos-amd64 ;;
    Linux-aarch64|Linux-arm64) platform=linux-arm64 ;;
    Linux-x86_64) platform=linux-amd64 ;;
    *) platform=unsupported ;;
  esac
  candidate="$repo_dir/artifacts/tools/code-server-4.137.0-$platform/bin/code-server"
  if [ -x "$candidate" ]; then
    export CASCAQIT_CODE_SERVER="$candidate"
  fi
fi
cd "$repo_dir"
# Retain Jupyter authentication; code-server is only exposed via its proxy.
exec "$runtime_venv/bin/jupyter" lab --no-browser \
  --ServerApp.ip=127.0.0.1 --ServerApp.root_dir="$repo_dir" "$@"

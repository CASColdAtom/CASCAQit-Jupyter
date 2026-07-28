#!/usr/bin/env bash
set -euo pipefail

readonly CASCAQIT_VERSION="1.0.5a0"
readonly CASCAQIT_WHEEL_NAME="cascaqit-${CASCAQIT_VERSION}-py3-none-any.whl"
readonly CASCAQIT_WHEEL_SHA256="af665bcd8dc81d7afe1370c1acee656dcc3192b63552429692655dc0159ee97e"
readonly CASCAQIT_REPOSITORY="CASColdAtom/CASCAQit"
readonly CASCAQIT_RELEASE="v1.0.5a"

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
download_dir="$(mktemp -d /tmp/cascaqit-codespaces.XXXXXX)"
wheel_path="${download_dir}/${CASCAQIT_WHEEL_NAME}"

cleanup() {
  rm -rf "${download_dir}"
}
trap cleanup EXIT

cd "${repo_dir}"

if [[ -n "${CASCAQIT_WHEEL_FILE:-}" ]]; then
  cp "${CASCAQIT_WHEEL_FILE}" "${wheel_path}"
else
  if ! command -v gh >/dev/null 2>&1; then
    echo "GitHub CLI is required to install the private CASCAQit wheel." >&2
    exit 1
  fi
  if ! gh auth status >/dev/null 2>&1; then
    echo "GitHub authentication with read access to CASColdAtom/CASCAQit is required." >&2
    exit 1
  fi
  gh release download "${CASCAQIT_RELEASE}" \
    --repo "${CASCAQIT_REPOSITORY}" \
    --pattern "${CASCAQIT_WHEEL_NAME}" \
    --dir "${download_dir}"
fi

printf '%s  %s\n' "${CASCAQIT_WHEEL_SHA256}" "${wheel_path}" | sha256sum --check --status

python -m pip install --disable-pip-version-check "${wheel_path}"
npm ci
python -m pip install --disable-pip-version-check ".[lab]"

bash .devcontainer/verify-environment.sh

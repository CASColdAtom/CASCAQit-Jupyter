#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repository_root"
runtime_venv=${CASCAQIT_JUPYTER_VENV:-"$repository_root/.venv"}
PATH="$runtime_venv/bin:$PATH"
export PATH

npm run build:prod
"$runtime_venv/bin/python" -m pip install --force-reinstall --no-deps --no-build-isolation .
exec node_modules/.bin/playwright test

#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repository_root"
PATH="$repository_root/.venv/bin:$PATH"
export PATH

npm run build:prod
.venv/bin/python -m pip install --force-reinstall --no-deps --no-build-isolation .
exec node_modules/.bin/playwright test

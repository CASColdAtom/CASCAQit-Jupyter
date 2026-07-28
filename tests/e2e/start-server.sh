#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repository_root"
PATH="$repository_root/.venv/bin:$PATH"
export PATH

.venv/bin/jupyter trust examples/read_only_renderers.ipynb
exec .venv/bin/jupyter lab \
  --no-browser \
  --ServerApp.root_dir=. \
  --IdentityProvider.token='' \
  --ServerApp.password='' \
  --LabApp.extension_manager=readonly \
  --ServerApp.port=8899 \
  --ServerApp.port_retries=0

#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repository_root"
runtime_venv=${CASCAQIT_JUPYTER_VENV:-"$repository_root/.venv"}
PATH="$runtime_venv/bin:$PATH"
export PATH

"$runtime_venv/bin/jupyter" trust examples/read_only_renderers.ipynb
exec "$runtime_venv/bin/jupyter" lab \
  --no-browser \
  --ServerApp.root_dir=. \
  --IdentityProvider.token='' \
  --ServerApp.password='' \
  --LabApp.extension_manager=readonly \
  --ServerApp.port=8899 \
  --ServerApp.port_retries=0

#!/usr/bin/env bash
set -euo pipefail

# Official standalone builds, pinned and verified. Never write to system directories.
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version=4.137.0
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform=macos-arm64; checksum=118604a8245816535d8e538f478d2ee93514bcb8ac75e210d2345a5dc7806f65 ;;
  Darwin-x86_64) platform=macos-amd64; checksum=f1403dab28a207d61e468f191fd7c41432543724cc57ac5cade4529666187b3a ;;
  Linux-aarch64|Linux-arm64) platform=linux-arm64; checksum=0fba760298fe06480d940e218f0873a645ba1e7e3ac4b527059af82d85a90462 ;;
  Linux-x86_64) platform=linux-amd64; checksum=9303165b7fd43532091922f77e2f119ff2fa109c6b6f1c3c966fb02f3d6d9c8b ;;
  *) echo 'Unsupported platform; install code-server manually.' >&2; exit 1 ;;
esac
tools_dir="$repo_dir/artifacts/tools"
package="code-server-$version-$platform"
archive="$tools_dir/$package.tar.gz"
mkdir -p "$tools_dir"
if [ ! -f "$archive" ]; then
  curl --fail --location --retry 3 \
    "https://github.com/coder/code-server/releases/download/v$version/$package.tar.gz" \
    --output "$archive"
fi
actual="$(shasum -a 256 "$archive")"
if [ "${actual%% *}" != "$checksum" ]; then
  echo "Checksum mismatch: $archive. Nothing was installed." >&2
  exit 1
fi
if [ ! -x "$tools_dir/$package/bin/code-server" ]; then
  tar -xzf "$archive" -C "$tools_dir"
fi
"$tools_dir/$package/bin/code-server" --config "$tools_dir/version-check.yaml" --version
echo 'Code is installed. Start with: bash scripts/start-workbench.sh'

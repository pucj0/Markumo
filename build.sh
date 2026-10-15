#!/usr/bin/env sh
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo '[ERROR] Install Node.js LTS (18 or newer), then run this script again.' >&2
  exit 1
fi
exec node "$PROJECT_DIR/scripts/package.mjs" "$@"

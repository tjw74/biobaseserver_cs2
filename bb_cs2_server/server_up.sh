#!/usr/bin/env bash
# Start (or create) the CS2 dedicated server container. Does not start a bot match — use bots_start.sh.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
exec docker compose up -d "$@"

#!/usr/bin/env bash
# Stop the CS2 server container (kills the whole game process). To clear bots only, use bots_stop.sh.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
exec docker compose stop "$@"

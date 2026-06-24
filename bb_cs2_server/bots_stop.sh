#!/usr/bin/env bash
# Stop the bot game only (RCON). Server keeps running. To shut down CS2, use server_stop.sh.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
R="${DIR}/rcon.sh"
: "${RCON_HOST:=127.0.0.1}"
: "${RCON_PORT:=27015}"
export RCON_HOST RCON_PORT
export RCON_PASSWORD="${RCON_PASSWORD:-${CS2_RCONPW:-changeme}}"

for cmd in "bot_kick" "bot_quota 0"; do
	echo ">>> $cmd"
	"$R" "$cmd" >/dev/null || true
done
echo "Bots cleared. Server still up — check: $R 'status' | head -18"

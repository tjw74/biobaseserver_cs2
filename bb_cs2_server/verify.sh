#!/usr/bin/env bash
# BioBase CS2 server verification — checks container, ports, RCON, plugins, dashboard.
# Usage: ./verify.sh    RCON_PASSWORD=secret ./verify.sh
set -u

CONTAINER_NAME="${CS2_CONTAINER_NAME:-bb_cs2_server}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
R="${DIR}/rcon.sh"

fail=0
ok()  { echo "[OK]   $*"; }
bad() { echo "[FAIL] $*"; fail=1; }

echo "=== BioBase CS2 Server Verification ==="
echo

if ! command -v docker >/dev/null 2>&1; then
	bad "docker not in PATH"
	exit 1
fi

if ! docker info >/dev/null 2>&1; then
	bad "docker not usable (daemon or permissions)"
	exit 1
fi

# Container running
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
	ok "Container ${CONTAINER_NAME} is running"
else
	bad "Container ${CONTAINER_NAME} not running"
fi

# RCON binary
if [[ ! -x "${DIR}/bin/mcrcon" ]]; then
	bad "Missing ${DIR}/bin/mcrcon"
fi

# Game port
HOST="${RCON_HOST:-127.0.0.1}"
PORT="${RCON_PORT:-27015}"

if timeout 2 bash -c "echo >/dev/tcp/${HOST}/${PORT}" 2>/dev/null; then
	ok "TCP ${HOST}:${PORT} open (game server)"
else
	bad "TCP ${HOST}:${PORT} not reachable"
fi

# RCON + plugins
if [[ -x "$R" && -x "${DIR}/bin/mcrcon" ]]; then
	meta="$("$R" "meta list" 2>&1 || true)"
	if echo "$meta" | grep -qi "BiobasePosEmitter\|CounterStrikeSharp"; then
		ok "Plugins loaded (BiobasePosEmitter)"
		echo "$meta" | sed 's/\x1b\[[0-9;]*m//g' | head -6
	else
		bad "BiobasePosEmitter not found in meta list"
		echo "$meta" | head -10
	fi

	st="$("$R" "status" 2>&1 || true)"
	if echo "$st" | grep -q "hostname\|map"; then
		ok "RCON status response"
		echo "$st" | sed 's/\x1b\[[0-9;]*m//g' | head -5
	else
		bad "Bad RCON status response"
		echo "$st" | head -10
	fi
else
	bad "Skipped RCON checks (missing rcon.sh or mcrcon)"
fi

# Dashboard
DASH_PORT="${BB_CS2_DASHBOARD_PORT:-8780}"
if timeout 2 bash -c "echo >/dev/tcp/127.0.0.1/${DASH_PORT}" 2>/dev/null; then
	ok "Dashboard reachable on port ${DASH_PORT}"
else
	bad "Dashboard not reachable on port ${DASH_PORT}"
fi

echo
if [[ "$fail" -ne 0 ]]; then
	echo "=== RESULT: FAILED ==="
	exit 1
fi
echo "=== RESULT: OK ==="
exit 0

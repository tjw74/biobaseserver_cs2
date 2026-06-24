#!/usr/bin/env bash
# RCON client wrapper (mcrcon by Tiiffi). Use from this directory, or set RCON_* env vars.
# Example: ./rcon.sh "meta list"   ./rcon.sh status
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${DIR}/bin/mcrcon" \
	-H "${RCON_HOST:-127.0.0.1}" \
	-P "${RCON_PORT:-27015}" \
	-p "${RCON_PASSWORD:-changeme}" \
	"$@"

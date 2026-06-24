#!/usr/bin/env bash
# Bot match only (RCON). Does NOT stop the CS2 process — use server_stop.sh for that.
# The base image has no cvar for bot_join_after_player; without it, bots may wait for a human.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
R="${DIR}/rcon.sh"
: "${RCON_HOST:=127.0.0.1}"
: "${RCON_PORT:=27015}"
export RCON_HOST RCON_PORT
export RCON_PASSWORD="${RCON_PASSWORD:-${CS2_RCONPW:-changeme}}"

BOT_QUOTA="${CS2_BOT_QUOTA:-10}"
BOT_MODE="${CS2_BOT_QUOTA_MODE:-fill}"
BOT_DIFF="${CS2_BOT_DIFFICULTY:-1}"

for cmd in \
	"bot_join_after_player 0" \
	"bot_quota $BOT_QUOTA" \
	"bot_quota_mode $BOT_MODE" \
	"bot_difficulty $BOT_DIFF" \
	"log on" \
	"sv_logecho 1" \
	"mp_logdetail 3" \
	"mp_warmup_end" \
	"mp_restartgame 1" \
; do
	echo ">>> $cmd"
	"$R" "$cmd" >/dev/null || true
done
echo "Done. Check: $R status | head -20"

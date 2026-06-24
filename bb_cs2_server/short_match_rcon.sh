#!/usr/bin/env bash
# Prepare bb_cs2_server for a bot deathmatch data-collection session **when CS2KZ is installed**.
# With BB_CS2_SERVER_PROFILE=play (default), use normal combat stacks instead — this script is for
# practice|kz installs where meta unload still fixes plugin hooks after a map change.
# Run on the host with bb_cs2_server up:  ./short_match_rcon.sh
# Set RCON_HOST / RCON_PORT / RCON_PASSWORD or CS2_RCONPW to match docker-compose.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
R="${DIR}/rcon.sh"
[[ -x "$R" ]] || { echo "missing $R"; exit 1; }

echo "bb_cs2_server: applying bot-deathmatch cvars (overrides CS2KZ defaults)"
# "$*" joins all args into a single RCON command string (mcrcon treats each arg as a command)
r() { "$R" "$*" 2>&1 | head -1 || true; }

# Unload CS2KZ plugin so its cvar hooks (mp_roundtime ↔ mp_timelimit sync, bot_stop) don't interfere.
# The plugin reloads on next map change; re-run this script after each changelevel.
r "meta unload 1"

# Switch from KZ custom mode (game_type 3) to casual (game_type 0, game_mode 0)
# so bots fight each other with standard round logic.
r "game_type 0"
r "game_mode 0"

# Unfreeze bots (cs2kz.cfg sets bot_stop 1).
r "bot_stop 0"
r "bot_join_after_player 0"

# Timing: roundtime and timelimit are independent once KZ is unloaded.
r "mp_roundtime 2"
r "mp_roundtime_defuse 2"
r "mp_timelimit 0"
r "mp_freezetime 0"
r "mp_halftime 0"

# Prevent map rotation at game over (cs2kz.cfg enables it).
r "mp_match_end_changelevel 0"

# Enable HL-format game event logging (kill/round/damage events → Loki).
r "log on"
r "sv_logecho 1"
r "mp_logdetail 3"

# Do not exec biobase_dev here — it restores practice cheats and breaks normal bot/combat rounds.
# To re-enable that bundle after tuning: RCON exec biobase_dev


r "mp_warmup_end"
r "mp_restartgame 1"
echo "Done. Bots should now fight on the current map; check status in ~10 s."

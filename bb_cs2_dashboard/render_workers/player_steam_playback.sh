#!/usr/bin/env bash
set -euo pipefail

CLIPS_HOST_DIR="${BB_CLIPS_HOST_DIR:-/mnt/backups/biobase/clips}"
PROJECT_ROOT="${BIOBASE_PROJECT_ROOT:-/home/clearmined/code/prod/biobase}"
RENDER_DIR="$PROJECT_ROOT/runtime/render_session"
DEMO_DIR="$RENDER_DIR/demos"
DISPLAY_NUM="${BIOBASE_RENDER_DISPLAY:-:99}"
USER_NAME="${BIOBASE_RENDER_USER:-clearmined}"
USER_HOME="/home/$USER_NAME"
LOG_DIR="$RENDER_DIR/logs"
LOG_FILE="$LOG_DIR/playback.log"

mkdir -p "$DEMO_DIR" "$LOG_DIR"

arg="${1:-}"
if [[ "$arg" == "--storage-name" ]]; then
  storage="${2:-}"
  [[ -n "$storage" ]] || { echo "storage name required" >&2; exit 2; }
  base="$(basename "$storage")"
  src="$CLIPS_HOST_DIR/$base"
else
  [[ -n "$arg" ]] || { echo "demo path or --storage-name required" >&2; exit 2; }
  if [[ "$arg" == /data/clips/* ]]; then
    src="$CLIPS_HOST_DIR/${arg#/data/clips/}"
  else
    src="$arg"
  fi
  base="$(basename "$src")"
fi

[[ "$base" == *.dem || "$base" == *.DEM ]] || { echo "expected .dem file: $base" >&2; exit 3; }
[[ -f "$src" ]] || { echo "demo not found on host: $src" >&2; exit 4; }

safe_base="$(printf '%s' "$base" | tr -c 'A-Za-z0-9._-' '_')"
dst="$DEMO_DIR/$safe_base"
cp -f "$src" "$dst"
chown "$USER_NAME:clarionlab" "$dst" 2>/dev/null || chown "$USER_NAME:$USER_NAME" "$dst" || true
chmod 664 "$dst" || true

systemctl is-active --quiet biobase-render-xorg.service || systemctl start biobase-render-xorg.service
systemctl is-active --quiet biobase-render-desktop.service || systemctl start biobase-render-desktop.service
systemctl is-active --quiet biobase-render-vnc.service || systemctl start biobase-render-vnc.service
systemctl is-active --quiet biobase-render-novnc.service || systemctl start biobase-render-novnc.service
systemctl is-active --quiet biobase-render-steam.service || systemctl start biobase-render-steam.service
/usr/local/bin/biobase-fit-steam-windows || true

cmd=(/usr/games/steam -applaunch 730 -console -insecure +playdemo "$dst")
{
  printf '
[%s] launching CS2 demo playback: %s
' "$(date -Is)" "$dst"
  printf 'command:'
  printf ' %q' "${cmd[@]}"
  printf '
'
} >> "$LOG_FILE"

runuser -u "$USER_NAME" -- env   DISPLAY="$DISPLAY_NUM"   HOME="$USER_HOME"   USER="$USER_NAME"   LOGNAME="$USER_NAME"   XDG_RUNTIME_DIR="/run/user/1000"   STEAM_FRAME_FORCE_CLOSE=1   "${cmd[@]}" >> "$LOG_FILE" 2>&1 &

printf 'started demo playback handoff: %s
' "$safe_base"
printf 'viewer: http://192.168.1.120:6080/vnc.html?autoconnect=1&resize=remote&path=websockify
'

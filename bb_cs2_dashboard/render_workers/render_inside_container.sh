#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: render_inside_container.sh <demo> <output.mp4>" >&2
  exit 64
fi
DEMO="$1"
OUTPUT="$2"
WIDTH="${RENDER_WIDTH:-1280}"
HEIGHT="${RENDER_HEIGHT:-720}"
FPS="${RENDER_FPS:-30}"
MAX_SECONDS="${RENDER_MAX_SECONDS:-900}"
DISPLAY_NUM="${RENDER_DISPLAY:-:99}"
DISPLAY="${DISPLAY_NUM}"
export DISPLAY

if [ ! -f "$DEMO" ]; then
  echo "demo missing: $DEMO" >&2
  exit 66
fi
if [ ! -x /runtime/run ]; then
  echo "Steam sniper runtime missing at /runtime/run" >&2
  exit 78
fi
if [ ! -x /cs2/game/cs2.sh ]; then
  echo "CS2 client missing at /cs2/game/cs2.sh" >&2
  exit 78
fi
mkdir -p "$(dirname "$OUTPUT")" /root/.steam/sdk64 /tmp/cs2-render
if [ -f /home/steam/steamcmd/linux64/steamclient.so ]; then
  cp /home/steam/steamcmd/linux64/steamclient.so /root/.steam/sdk64/steamclient.so
fi

Xvfb "$DISPLAY_NUM" -screen 0 "${WIDTH}x${HEIGHT}x24" -ac +extension GLX +render -noreset >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!
cleanup() {
  set +e
  if [ -n "${CS2_PID:-}" ]; then kill "$CS2_PID" >/dev/null 2>&1 || true; fi
  if [ -n "${FFMPEG_PID:-}" ]; then kill -INT "$FFMPEG_PID" >/dev/null 2>&1 || true; fi
  if [ -n "${FFMPEG_PID:-}" ]; then wait "$FFMPEG_PID" >/dev/null 2>&1 || true; fi
  kill "$XVFB_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT
sleep 1

TMP_OUTPUT="${OUTPUT}.recording.mp4"
rm -f "$TMP_OUTPUT"
ffmpeg -hide_banner -loglevel warning -y \
  -f x11grab -draw_mouse 0 -video_size "${WIDTH}x${HEIGHT}" -framerate "$FPS" -i "$DISPLAY_NUM" \
  -t "$MAX_SECONDS" -c:v libx264 -preset veryfast -pix_fmt yuv420p -movflags +faststart "$TMP_OUTPUT" >/tmp/ffmpeg.log 2>&1 &
FFMPEG_PID=$!

cd /cs2/game
set +e
timeout "$MAX_SECONDS" /runtime/run -- ./cs2.sh \
  -vulkan -windowed -w "$WIDTH" -h "$HEIGHT" -novid -insecure -nojoy -console \
  +playdemo "$DEMO" > /tmp/cs2.log 2>&1 &
CS2_PID=$!
wait "$CS2_PID"
CS2_STATUS=$?
set -e

sleep 2
kill -INT "$FFMPEG_PID" >/dev/null 2>&1 || true
wait "$FFMPEG_PID" >/dev/null 2>&1 || true

if [ "$CS2_STATUS" -ne 0 ] && [ "$CS2_STATUS" -ne 124 ]; then
  echo "CS2 exited before/while rendering with status $CS2_STATUS" >&2
  echo "--- cs2 tail ---" >&2
  tail -120 /tmp/cs2.log >&2 || true
  echo "--- xvfb tail ---" >&2
  tail -80 /tmp/xvfb.log >&2 || true
  echo "--- ffmpeg tail ---" >&2
  tail -80 /tmp/ffmpeg.log >&2 || true
  exit "$CS2_STATUS"
fi
if [ ! -s "$TMP_OUTPUT" ]; then
  echo "ffmpeg did not produce a non-empty MP4" >&2
  echo "--- cs2 tail ---" >&2
  tail -120 /tmp/cs2.log >&2 || true
  echo "--- ffmpeg tail ---" >&2
  tail -80 /tmp/ffmpeg.log >&2 || true
  exit 70
fi
mv "$TMP_OUTPUT" "$OUTPUT"

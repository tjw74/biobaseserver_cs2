#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: cs2_video_render.sh <demo-path-in-dashboard> <output-mp4-path-in-dashboard>" >&2
  exit 64
fi

DASH_DEMO="$1"
DASH_OUTPUT="$2"
CLIPS_CONTAINER_ROOT="${BB_CLIPS_UPLOAD_DIR:-/data/clips}"
CLIPS_HOST_ROOT="${BB_CLIPS_VM_PATH:-}"
CS2_CLIENT_DIR="${BB_CS2_CLIENT_DIR:-/home/clearmined/code/prod/biobase/runtime/cs2_client}"
STEAM_RUNTIME_DIR="${BB_STEAM_RUNTIME_DIR:-/home/clearmined/code/prod/biobase/runtime/steam_runtime}"
RENDER_IMAGE="${BB_RENDER_IMAGE:-bb-cs2-renderer:local}"
WIDTH="${BB_RENDER_WIDTH:-1280}"
HEIGHT="${BB_RENDER_HEIGHT:-720}"
FPS="${BB_RENDER_FPS:-30}"
MAX_SECONDS="${BB_RENDER_MAX_SECONDS:-900}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing command: $1" >&2; exit 69; }; }
need docker

if [ -z "$CLIPS_HOST_ROOT" ]; then
  echo "BB_CLIPS_VM_PATH/BB_CLIPS_HOST_DIR must be set so host Docker can mount the same clips directory." >&2
  exit 78
fi
if [ ! -S /var/run/docker.sock ]; then
  echo "docker socket not mounted at /var/run/docker.sock" >&2
  exit 78
fi
if [ ! -r "$DASH_DEMO" ]; then
  echo "demo not readable in dashboard container: $DASH_DEMO" >&2
  exit 66
fi
case "$DASH_DEMO" in
  "$CLIPS_CONTAINER_ROOT"/*) REL_DEMO="${DASH_DEMO#"$CLIPS_CONTAINER_ROOT"/}" ;;
  *) echo "demo path is outside clips root: $DASH_DEMO" >&2; exit 78 ;;
esac
case "$DASH_OUTPUT" in
  "$CLIPS_CONTAINER_ROOT"/*) REL_OUTPUT="${DASH_OUTPUT#"$CLIPS_CONTAINER_ROOT"/}" ;;
  *) echo "output path is outside clips root: $DASH_OUTPUT" >&2; exit 78 ;;
esac

mkdir -p "$(dirname "$DASH_OUTPUT")"

# Host Docker sees host paths, not dashboard-container paths. The worker mounts the same clips root at /data/clips.
docker run --rm --privileged \
  -v "$CLIPS_HOST_ROOT:/data/clips:rw" \
  -v "$CS2_CLIENT_DIR:/cs2:ro" \
  -v "$STEAM_RUNTIME_DIR:/runtime:rw" \
  -e RENDER_WIDTH="$WIDTH" \
  -e RENDER_HEIGHT="$HEIGHT" \
  -e RENDER_FPS="$FPS" \
  -e RENDER_MAX_SECONDS="$MAX_SECONDS" \
  "$RENDER_IMAGE" \
  "/data/clips/$REL_DEMO" "/data/clips/$REL_OUTPUT"

if [ ! -s "$DASH_OUTPUT" ]; then
  echo "renderer completed but output MP4 is missing/empty: $DASH_OUTPUT" >&2
  exit 70
fi

#!/usr/bin/env bash
# Best-effort fetch of the awpy CI matchmaking demo (Figshare).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$ROOT/fixtures/sample.dem}"
URL="${DEMO_FIXTURE_URL:-https://figshare.com/ndownloader/files/52456259}"

mkdir -p "$(dirname "$DEST")"
echo "Fetching demo to $DEST"
echo "URL: $URL"

if curl -fL --retry 3 --connect-timeout 20 --max-time 600 -o "$DEST.part" "$URL"; then
  sz=$(wc -c <"$DEST.part" | tr -d " ")
  if [ "${sz:-0}" -lt 4096 ]; then
    rm -f "$DEST.part"
    echo >&2 "Download too small (${sz} bytes) — likely a WAF/challenge page, not a demo."
    exit 1
  fi
  mv "$DEST.part" "$DEST"
  echo "OK: $(wc -c < "$DEST") bytes"
  sha256sum "$DEST"
  exit 0
fi

rm -f "$DEST.part"
echo >&2 ""
echo >&2 "Automated fetch failed (Figshare may require a browser/WAF). Options:"
echo >&2 "  1) Open the URL in a browser, save as: $DEST"
echo >&2 "  2) Copy any local CS2 .dem to: $DEST"
echo >&2 "  3) Override URL: DEMO_FIXTURE_URL=... $0"
exit 1

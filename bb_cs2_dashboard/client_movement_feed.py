"""In-memory BIOBASE_POS_JSON cache for the desktop client live HUD."""

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from typing import Any

_BIOBASE_POS_RE = re.compile(r"BIOBASE_POS_JSON\s+(\{.+\})\s*$")
CS2_CONTAINER = os.environ.get("BB_CS2_SERVER_CONTAINER", "bb_cs2_server").strip() or "bb_cs2_server"
DOCKER_BIN = os.environ.get("BB_DOCKER_BIN", "/usr/bin/docker").strip() or "/usr/bin/docker"
POLL_INTERVAL_SEC = float(os.environ.get("BB_CLIENT_MOVEMENT_POLL_SEC", "0.15"))
LOG_TAIL_LINES = int(os.environ.get("BB_CLIENT_MOVEMENT_LOG_TAIL", "160"))

_lock = threading.Lock()
_latest_by_steam: dict[str, dict[str, Any]] = {}
_feed_started = False
_last_error: str | None = None
_last_observed_at: str | None = None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_pos_line(line: str) -> dict[str, Any] | None:
    match = _BIOBASE_POS_RE.search(line)
    if not match:
        return None
    try:
        data = json.loads(match.group(1))
        pos = data.get("pos") or []
        vel = data.get("vel") or []
        steamid = str(data.get("steamid") or "").strip()
        if not steamid:
            return None
        return {
            "player": data.get("player"),
            "steamid": steamid,
            "tick": data.get("tick"),
            "pos": pos,
            "vel": vel,
            "speed": data.get("speed"),
            "yaw": data.get("yaw"),
            "pitch": data.get("pitch"),
            "on_ground": data.get("on_ground"),
            "observedAt": _utc_now(),
        }
    except (json.JSONDecodeError, IndexError, TypeError, KeyError):
        return None


def _ingest_line(line: str) -> None:
    global _last_observed_at
    sample = parse_pos_line(line)
    if not sample:
        return
    steamid = sample["steamid"]
    with _lock:
        _latest_by_steam[steamid] = sample
        _last_observed_at = sample["observedAt"]


def _poll_once() -> None:
    global _last_error
    proc = subprocess.run(
        [DOCKER_BIN, "logs", "--tail", str(LOG_TAIL_LINES), CS2_CONTAINER],
        capture_output=True,
        text=True,
        timeout=12,
        check=False,
    )
    if proc.returncode != 0 and proc.stderr:
        _last_error = proc.stderr.strip()[:300]
        return
    for line in (proc.stdout or "").splitlines():
        _ingest_line(line)
    _last_error = None


def _poll_loop() -> None:
    while True:
        try:
            _poll_once()
        except Exception as exc:
            global _last_error
            _last_error = str(exc)[:300]
        time.sleep(POLL_INTERVAL_SEC)


def start_movement_feed() -> None:
    global _feed_started
    if _feed_started:
        return
    _feed_started = True
    thread = threading.Thread(target=_poll_loop, daemon=True, name="biobase-client-movement-feed")
    thread.start()


def _pick_tracked_sample(
    samples: list[dict[str, Any]],
    steamid: str | None,
    player: str | None,
) -> list[dict[str, Any]]:
    if steamid:
        key = steamid.strip()
        with _lock:
            tracked = _latest_by_steam.get(key)
        return [tracked] if tracked else [s for s in samples if s.get("steamid") == key]
    if player:
        needle = player.strip().lower()
        matched = [s for s in samples if (s.get("player") or "").lower() == needle]
        return matched
    humans = [s for s in samples if s.get("steamid") not in ("", "BOT")]
    if humans:
        return humans
    return samples


def get_movement_snapshot(
    steamid: str | None = None,
    player: str | None = None,
) -> dict[str, Any]:
    with _lock:
        all_samples = list(_latest_by_steam.values())
        last_error = _last_error
        last_observed = _last_observed_at
        feed_active = _feed_started
    selected = _pick_tracked_sample(all_samples, steamid, player)
    ok = len(selected) > 0
    return {
        "ok": ok,
        "polledAt": _utc_now(),
        "lastObservedAt": last_observed,
        "feedActive": feed_active,
        "samples": selected if (steamid or player) else all_samples,
        "tracked": selected[0] if selected else None,
        "error": None if ok else (last_error or "no_movement_samples"),
    }

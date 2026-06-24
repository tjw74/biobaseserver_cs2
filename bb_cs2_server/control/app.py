"""
Web UI API for CS2 bot game start/stop and map change (RCON via mcrcon). Same commands as bots_*.sh.
"""

from __future__ import annotations

import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

RCON_HOST = os.environ.get("RCON_HOST", "bb_cs2_server")
RCON_PORT = int(os.environ.get("RCON_PORT", "27015"))
RCON_PASSWORD = os.environ.get("RCON_PASSWORD", os.environ.get("RCON_PW", "changeme"))
MCRCON_BIN = os.environ.get("MCRCON_BIN", "/usr/local/bin/mcrcon")
RCON_TIMEOUT = float(os.environ.get("RCON_TIMEOUT", "15"))
CAPABILITIES_RCON_TIMEOUT = float(os.environ.get("CAPABILITIES_RCON_TIMEOUT", "4"))
STATUS_SNIPPET_CHARS = int(os.environ.get("CAPABILITIES_STATUS_SNIPPET", "1200"))
PROBE_SNIPPET_CHARS = int(os.environ.get("CAPABILITIES_PROBE_SNIPPET", "800"))

BOT_QUOTA = os.environ.get("CS2_BOT_QUOTA", "10")
BOT_MODE = os.environ.get("CS2_BOT_QUOTA_MODE", "fill")
BOT_DIFF = os.environ.get("CS2_BOT_DIFFICULTY", "1")
CONTROL_TOKEN = os.environ.get("BB_CS2_CONTROL_TOKEN", "").strip()

STATIC = Path(__file__).resolve().parent / "static"
app = FastAPI(title="bb_cs2_control", version="1.0.0")

_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_MAP_WORKSHOP_ID = re.compile(r"^[0-9]{6,20}$")
_MAP_STOCK = re.compile(r"^[a-zA-Z0-9_]{1,64}$")

# Matches CS2 `status` player rows (format differs from CS:GO).
# Header:  id  time  ping  loss  state  rate  [adr]  name
# Bot row: "   0      BOT    0    0     active      0 'BotName '"
# Player:  "   2    12:45   45    0     active 196608 '1.2.3.4:27005' 'HumanName'"
# Strategy: capture id/time/ping/loss/state, then take the LAST single-quoted
# field on the line as the player name (backtracking handles optional address).
_PLAYER_ROW_RE = re.compile(
    r"^\s+(\d+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\w+)\s+\d+"  # id, time/BOT, ping, loss, state, rate
    r"(?:\s+'[^']*')?"                                     # optional address (e.g. '1.2.3.4:27005')
    r"\s+'([^']*)'",                                        # name (last single-quoted field)
    re.MULTILINE,
)


def _strip_ansi(s: str) -> str:
    return _ANSI.sub("", s)


def mcrcon_run(*command_parts: str, timeout: float | None = None) -> tuple[int, str]:
    t = RCON_TIMEOUT if timeout is None else timeout
    # mcrcon appends a single trailing argument to the RCON line; join multi-token CS2 commands.
    cmd_str = " ".join(command_parts)
    cmd = [MCRCON_BIN, "-H", RCON_HOST, "-P", str(RCON_PORT), "-p", RCON_PASSWORD, cmd_str]
    try:
        p = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=t,
        )
    except subprocess.TimeoutExpired:
        return -2, "timeout"
    out = (p.stdout or "") + (p.stderr or "")
    return p.returncode, out.strip()


def parse_map_target(raw: str) -> tuple[str, str]:
    """Return (token, kind) where kind is 'stock' or 'workshop'."""
    s = raw.strip()
    if not s:
        raise ValueError("empty map")
    if _MAP_WORKSHOP_ID.fullmatch(s):
        return s, "workshop"
    if s.isdigit():
        raise ValueError("workshop map id must be 6-20 digits")
    if not _MAP_STOCK.fullmatch(s):
        raise ValueError("map name must be alphanumeric/underscore or a workshop id")
    return s, "stock"


def require_token(authorization: str | None, x_api_key: str | None) -> None:
    if not CONTROL_TOKEN:
        return
    if x_api_key == CONTROL_TOKEN:
        return
    if authorization and authorization.startswith("Bearer ") and authorization[7:] == CONTROL_TOKEN:
        return
    raise HTTPException(status_code=401, detail="Unauthorized")


def parse_players(text: str) -> list[dict]:
    """Extract per-player rows from `status` command output."""
    text = _strip_ansi(text)
    players = []
    for m in _PLAYER_ROW_RE.finditer(text):
        slot, time_or_bot, ping, loss, state, name = m.groups()
        is_bot = time_or_bot.upper() == "BOT"
        players.append(
            {
                "userid": int(slot),
                "name": name.strip(),
                "steamid": "BOT" if is_bot else None,
                "connected": None if is_bot else time_or_bot,
                "ping": int(ping),
                "loss": int(loss),
                "state": state,
            }
        )
    return players


def parse_status(text: str) -> dict:
    text = _strip_ansi(text)
    humans: int | None = None
    bots: int | None = None
    m = re.search(
        r"players\s*:\s*(\d+)\s*humans,\s*(\d+)\s*bots",
        text,
        re.IGNORECASE,
    )
    if m:
        try:
            humans = int(m.group(1))
            bots = int(m.group(2))
        except ValueError:
            pass

    map_name = None
    m2 = re.search(r"\[1:\s*([a-z0-9_]+)\s*\|", text, re.IGNORECASE)
    if m2:
        map_name = m2.group(1)
    if not map_name:
        m3 = re.search(r"^map\s*:\s*(\S+)", text, re.IGNORECASE | re.MULTILINE)
        if m3:
            map_name = m3.group(1).strip()

    host_m = re.search(r"hostname\s*:\s*(.+)$", text, re.IGNORECASE | re.MULTILINE)
    hostname = host_m.group(1).strip() if host_m else None

    server_running = "Server:" in text and "Running" in text

    if not server_running and "Server:" in text:
        headline = "Server not responding as running"
    elif humans is not None and bots is not None and bots > 0:
        headline = "Bot game running"
    elif humans is not None and bots is not None and bots == 0:
        headline = "No bots in game"
    else:
        headline = "Status partially parsed"

    return {
        "headline": headline,
        "humans": humans,
        "bots": bots,
        "map": map_name,
        "hostname": hostname,
        "server_listed_running": server_running,
        "rcon_ok": True,
        "rcon_code": 0,
        "players": parse_players(text),
    }


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _snippet(text: str | None, max_chars: int) -> str:
    if not text:
        return ""
    t = text.strip()
    if len(t) <= max_chars:
        return t
    return t[: max_chars - 1] + "…"


def _env_server_profile() -> dict[str, str]:
    raw = os.environ.get("BB_CS2_SERVER_PROFILE", "").strip()
    if not raw:
        return {"value": "unknown", "source": "unset"}
    return {"value": raw.lower(), "source": "env"}


def _env_cheats_launch() -> dict:
    raw = os.environ.get("CS2_CHEATS", "").strip()
    if raw == "":
        return {"value": None, "known": False}
    return {"value": raw, "known": True}


def _rcon_tri(rcon_ok: bool, cmd_ok: bool, found: bool) -> str:
    if not rcon_ok or not cmd_ok:
        return "unknown"
    return "enabled" if found else "disabled"


def _parse_sv_cheats_output(text: str) -> tuple[str, str]:
    """Return (state, optional detail). state is on|off|unknown."""
    clean = _strip_ansi(text)
    m = re.search(r"sv_cheats\b\D*(\d+)", clean, re.IGNORECASE)
    if m:
        return ("on" if m.group(1) == "1" else "off"), ""
    low = clean.lower()
    if "= 1" in low and "sv_cheat" in low:
        return "on", ""
    if "true" in low and "sv_cheat" in low:
        return "on", ""
    return "unknown", _snippet(clean, 120)


def _collect_plugin_blob(meta_list: str, css_list: str, meta_version: str) -> str:
    parts = [meta_version or "", meta_list or "", css_list or ""]
    return _strip_ansi("\n".join(parts)).lower()


def _capabilities_payload() -> dict:
    tmo = CAPABILITIES_RCON_TIMEOUT
    profile = _env_server_profile()
    cheats_env = _env_cheats_launch()

    st_code, st_text = mcrcon_run("status", timeout=tmo)
    rcon_ok = st_code == 0
    st_parsed = parse_status(st_text) if rcon_ok else None
    status_block = {
        "ok": rcon_ok,
        "exit_code": st_code,
        "snippet": _snippet(st_text, STATUS_SNIPPET_CHARS),
        "headline": (st_parsed or {}).get("headline"),
        "humans": (st_parsed or {}).get("humans"),
        "bots": (st_parsed or {}).get("bots"),
        "map": (st_parsed or {}).get("map"),
        "hostname": (st_parsed or {}).get("hostname"),
    }

    mv_code, mv_text = mcrcon_run("meta version", timeout=tmo)
    ml_code, ml_text = mcrcon_run("meta list", timeout=tmo)

    cs_code, cs_text = -1, ""
    for probe in ("css_plugins list", "css list"):
        cs_code, cs_text = mcrcon_run(probe, timeout=tmo)
        if cs_code != 0:
            continue
        low = _strip_ansi(cs_text or "").lower()
        if "unknown command" in low and "list" in low:
            continue
        break

    sc_code, sc_text = mcrcon_run("sv_cheats", timeout=tmo)
    cheat_state, cheat_note = (
        _parse_sv_cheats_output(sc_text) if sc_code == 0 else ("unknown", "")
    )
    cheats_payload: dict = {
        "state": cheat_state if rcon_ok and sc_code == 0 else "unknown",
        "source": "rcon" if rcon_ok and sc_code == 0 else "unavailable",
        "detail": (cheat_note or None) if cheat_note else None,
        "launch_env": cheats_env,
    }

    blob = _collect_plugin_blob(ml_text, cs_text, mv_text)
    meta_list_ok = rcon_ok and ml_code == 0
    meta_version_ok = rcon_ok and mv_code == 0
    css_ok = rcon_ok and cs_code == 0

    ml_low = (ml_text or "").lower()
    mv_low = (mv_text or "").lower()
    metamod_found = (
        meta_version_ok and ("metamod" in mv_low or "mmsource" in mv_low)
    ) or (
        meta_list_ok
        and "unknown command" not in ml_low
        and bool((ml_text or "").strip())
    )

    css_found = False
    if meta_list_ok:
        css_found = (
            "counterstrikesharp" in blob
            or "cs sharp" in blob
            or ("sharp" in blob and "dotnet" in blob)
        )
    if not css_found and css_ok and _strip_ansi(cs_text).strip():
        csl = _strip_ansi(cs_text).lower()
        css_found = (
            "plugin" in csl
            or "loaded" in csl
            or "[" in csl
            or len(csl.strip()) > 24
        )
    css_cmd_ok = meta_list_ok or css_ok

    matchzy_found = "matchzy" in blob
    kz_found = "cs2kz" in blob or "kz-global" in blob or "kzglobal" in blob
    biobase_found = "biobase" in blob or "posemitter" in blob

    plugins = {
        "metamod": {
            "state": _rcon_tri(rcon_ok, meta_version_ok, metamod_found),
        },
        "counterstrikesharp": {
            "state": _rcon_tri(rcon_ok, css_cmd_ok, css_found),
        },
        "matchzy": {
            "state": _rcon_tri(rcon_ok, meta_list_ok, matchzy_found),
        },
        "kz": {
            "state": _rcon_tri(rcon_ok, meta_list_ok, kz_found),
        },
        "biobase_pos": {
            "state": _rcon_tri(rcon_ok, meta_list_ok or css_ok, biobase_found),
        },
    }

    return {
        "checked_at": _utc_now_iso(),
        "server_profile": profile,
        "rcon": {"reachable": rcon_ok, "status": status_block},
        "cheats": cheats_payload,
        "plugins": plugins,
        "probes": {
            "meta_version": {
                "ok": mv_code == 0,
                "exit_code": mv_code,
                "snippet": _snippet(mv_text, PROBE_SNIPPET_CHARS),
            },
            "meta_list": {
                "ok": ml_code == 0,
                "exit_code": ml_code,
                "snippet": _snippet(ml_text, PROBE_SNIPPET_CHARS),
            },
            "css_list": {
                "ok": cs_code == 0,
                "exit_code": cs_code,
                "snippet": _snippet(cs_text, PROBE_SNIPPET_CHARS),
            },
            "sv_cheats": {
                "ok": sc_code == 0,
                "exit_code": sc_code,
                "snippet": _snippet(sc_text, PROBE_SNIPPET_CHARS),
            },
        },
    }


@app.get("/api/capabilities")
def api_capabilities() -> JSONResponse:
    return JSONResponse(_capabilities_payload())


@app.get("/api/status")
def api_status() -> JSONResponse:
    code, text = mcrcon_run("status")
    if code != 0:
        return JSONResponse(
            {
                "headline": "RCON failed",
                "humans": None,
                "bots": None,
                "map": None,
                "hostname": None,
                "server_listed_running": False,
                "rcon_ok": False,
                "rcon_code": code,
                "rcon_error": text[:2000] if text else None,
                "raw": text[:4000] if text else "",
            }
        )
    data = parse_status(text)
    return JSONResponse(data)


@app.post("/api/bots/start")
def api_bots_start(
    authorization: str | None = Header(None),
    x_api_key: str | None = Header(None, alias="X-Api-Key"),
) -> JSONResponse:
    require_token(authorization, x_api_key)
    steps = [
        "bot_join_after_player 0",
        f"bot_quota {BOT_QUOTA}",
        f"bot_quota_mode {BOT_MODE}",
        f"bot_difficulty {BOT_DIFF}",
        "log on",
        "sv_logecho 1",
        # Required for HL combat lines with attacker/victim [x y z] + damage fields (Docker logs ingest).
        "mp_logdetail 3",
        "mp_warmup_end",
        "mp_restartgame 1",
    ]
    last_err = None
    for s in steps:
        code, out = mcrcon_run(s)
        if code != 0:
            last_err = f"{s!r} exit {code}: {out[:500]}"
            return JSONResponse({"ok": False, "error": last_err, "step": s}, status_code=502)
    return JSONResponse({"ok": True, "message": "Bot game start commands sent."})


@app.post("/api/bots/stop")
def api_bots_stop(
    authorization: str | None = Header(None),
    x_api_key: str | None = Header(None, alias="X-Api-Key"),
) -> JSONResponse:
    require_token(authorization, x_api_key)
    for s in ("bot_kick", "bot_quota 0"):
        code, out = mcrcon_run(s)
        if code != 0:
            return JSONResponse(
                {"ok": False, "error": f"{s!r} exit {code}: {out[:500]}", "step": s},
                status_code=502,
            )
    return JSONResponse({"ok": True, "message": "Bots cleared."})


class MapChangeBody(BaseModel):
    map: str = Field(..., min_length=1, max_length=96)


@app.post("/api/map")
def api_change_map(
    body: MapChangeBody,
    authorization: str | None = Header(None),
    x_api_key: str | None = Header(None, alias="X-Api-Key"),
) -> JSONResponse:
    require_token(authorization, x_api_key)
    try:
        target, kind = parse_map_target(body.map)
    except ValueError as e:
        return JSONResponse(
            {"ok": False, "error": str(e)},
            status_code=400,
        )
    if kind == "workshop":
        code, out = mcrcon_run("host_workshop_map", target)
        if code != 0:
            return JSONResponse(
                {
                    "ok": False,
                    "error": f"host_workshop_map {target!r} exit {code}: {out[:500]}",
                },
                status_code=502,
            )
        return JSONResponse({"ok": True, "message": f"Workshop map {target} requested."})

    # Stock maps: try `map` first (reliable on many CS2 dedicated setups), then `changelevel`.
    last_code, last_out = -1, ""
    for verb in ("map", "changelevel"):
        code, out = mcrcon_run(verb, target)
        last_code, last_out = code, out
        if code == 0:
            return JSONResponse({"ok": True, "message": f"Changing map to {target} ({verb})."})
    return JSONResponse(
        {
            "ok": False,
            "error": f"map/changelevel failed (last exit {last_code}): {last_out[:500]}",
        },
        status_code=502,
    )


@app.get("/")
def index() -> FileResponse:
    p = STATIC / "bb_cs2_bot_game.html"
    if not p.is_file():
        raise HTTPException(status_code=500, detail="static UI missing")
    return FileResponse(p, media_type="text/html; charset=utf-8")


@app.get("/bb_cs2_bot_game.html", include_in_schema=False)
def ui_named() -> FileResponse:
    return index()


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


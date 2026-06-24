"""Public Biobase desktop client API (no admin dashboard login)."""

from __future__ import annotations

import json
import os
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from client_movement_feed import get_movement_snapshot, start_movement_feed
from client_session_store import ClientSessionStore

CLIENT_PAIRING_CODE = os.environ.get("BB_CLIENT_PAIRING_CODE", "BIOBASE-TRY").strip().upper()
CLIENT_DATA_DIR = Path(os.environ.get("BB_CLIENT_DATA_DIR", "/data/clips/.biobase_client")).resolve()
CLIENT_REMOTE_SECRET = os.environ.get("BB_CLIENT_REMOTE_SECRET", "").strip()
DASHBOARD_TOKEN = os.environ.get("BB_CS2_DASHBOARD_TOKEN", "").strip()
CS2_CONNECT_HOST = os.environ.get("BB_CS2_CONNECT_HOST", "cs2.clarionlab.dev").strip()
CS2_CONNECT_PORT = int(os.environ.get("BB_CS2_CONNECT_PORT", "27015"))

# Remote device commands (force_update, kill_app, close_overlay):
#   Operator queues:  POST /api/client/device/commands  (X-Biobase-Remote-Secret or dashboard Bearer)
#   Device polls:     GET  /api/client/device/commands  (X-Biobase-Device-Id + X-Biobase-Device-Token)
#   Queue file:       {CLIENT_DATA_DIR}/device_commands.json
VALID_DEVICE_COMMANDS = frozenset({"force_update", "kill_app", "close_overlay"})
MAIN_SCOPE_COMMANDS = frozenset({"force_update", "close_overlay"})
WATCHDOG_SCOPE_COMMANDS = frozenset({"kill_app", "close_overlay"})


class ClientPairBody(BaseModel):
    pairingCode: str = Field(default="", alias="pairingCode")
    deviceName: str = "Biobase Client"
    serverName: str = "Biobase CS2"
    appVersion: str = "0.0.0"

    model_config = {"populate_by_name": True}


class ClientQueueCommandBody(BaseModel):
    deviceId: str = Field(..., min_length=8, max_length=64, alias="deviceId")
    command: str = Field(..., min_length=3, max_length=32)

    model_config = {"populate_by_name": True}


class ClientPresenceBody(BaseModel):
    sessionId: str = Field(..., min_length=8, max_length=64, alias="sessionId")
    deviceName: str = "Biobase Client"
    playerName: str = ""
    shareStats: bool = True
    appVersion: str = "0.0.0"
    hostname: str = ""

    model_config = {"populate_by_name": True}


class CompanionLinkBody(BaseModel):
    playerName: str = Field(default="", alias="playerName")
    steamid: str = ""
    deviceName: str = "Biobase Client"

    model_config = {"populate_by_name": True}


_presence_sessions: dict[str, dict[str, Any]] = {}
COMPANION_CODE_TTL_SEC = int(os.environ.get("BB_COMPANION_CODE_TTL_SEC", str(72 * 3600)))
_COMPANION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _devices_path() -> Path:
    CLIENT_DATA_DIR.mkdir(parents=True, exist_ok=True)
    return CLIENT_DATA_DIR / "devices.json"


def _sessions_path() -> Path:
    """Legacy JSONL path retained for migration tooling."""
    CLIENT_DATA_DIR.mkdir(parents=True, exist_ok=True)
    return CLIENT_DATA_DIR / "sessions.jsonl"


def _session_store() -> ClientSessionStore:
    return ClientSessionStore(CLIENT_DATA_DIR)


def _commands_path() -> Path:
    CLIENT_DATA_DIR.mkdir(parents=True, exist_ok=True)
    return CLIENT_DATA_DIR / "device_commands.json"


def _companion_links_path() -> Path:
    CLIENT_DATA_DIR.mkdir(parents=True, exist_ok=True)
    return CLIENT_DATA_DIR / "companion_links.json"


def _load_companion_links() -> dict[str, Any]:
    path = _companion_links_path()
    if not path.is_file():
        return {"links": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"links": {}}
    if not isinstance(data, dict):
        return {"links": {}}
    data.setdefault("links", {})
    return data


def _save_companion_links(data: dict[str, Any]) -> None:
    _companion_links_path().write_text(json.dumps(data, indent=2), encoding="utf-8")


def _new_companion_code() -> str:
    return "".join(secrets.choice(_COMPANION_ALPHABET) for _ in range(8))


def _prune_companion_links(store: dict[str, Any]) -> None:
    links = store.get("links", {})
    if not isinstance(links, dict):
        store["links"] = {}
        return
    cutoff = datetime.now(timezone.utc).timestamp() - COMPANION_CODE_TTL_SEC
    stale = [
        code
        for code, entry in links.items()
        if not isinstance(entry, dict) or float(entry.get("_expiresAt", 0)) < cutoff
    ]
    for code in stale:
        links.pop(code, None)
    store["links"] = links


def _create_companion_link(*, player_name: str, steamid: str = "", device_name: str = "") -> dict[str, Any]:
    store = _load_companion_links()
    _prune_companion_links(store)
    links = store.setdefault("links", {})
    code = _new_companion_code()
    while code in links:
        code = _new_companion_code()
    now = datetime.now(timezone.utc)
    expires_at = now.timestamp() + COMPANION_CODE_TTL_SEC
    record = {
        "code": code,
        "playerName": player_name.strip()[:80],
        "steamid": steamid.strip()[:32],
        "deviceName": device_name.strip()[:80] or "Biobase Client",
        "createdAt": _utc_now(),
        "_expiresAt": expires_at,
    }
    links[code] = record
    store["links"] = links
    _save_companion_links(store)
    public_host = CS2_CONNECT_HOST
    return {
        "ok": True,
        "code": code,
        "playerName": record["playerName"],
        "steamid": record["steamid"],
        "url": f"https://{public_host}/c/{code}",
        "companionPath": f"/companion/c/{code}",
        "expiresAt": datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def _resolve_companion_link(code: str) -> dict[str, Any] | None:
    normalized = code.strip().upper()
    if not normalized or len(normalized) > 16:
        return None
    store = _load_companion_links()
    _prune_companion_links(store)
    entry = store.get("links", {}).get(normalized)
    if not isinstance(entry, dict):
        return None
    if float(entry.get("_expiresAt", 0)) < datetime.now(timezone.utc).timestamp():
        links = store.get("links", {})
        if isinstance(links, dict):
            links.pop(normalized, None)
            store["links"] = links
            _save_companion_links(store)
        return None
    return {
        "ok": True,
        "code": normalized,
        "playerName": entry.get("playerName") or "",
        "steamid": entry.get("steamid") or "",
        "deviceName": entry.get("deviceName") or "",
        "createdAt": entry.get("createdAt"),
    }


def _load_devices() -> dict[str, Any]:
    path = _devices_path()
    if not path.is_file():
        return {"devices": {}}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"devices": {}}


def _save_devices(data: dict[str, Any]) -> None:
    _devices_path().write_text(json.dumps(data, indent=2), encoding="utf-8")


def _verify_device(device_id: str | None, device_token: str | None) -> dict[str, Any] | None:
    if not device_id or not device_token:
        return None
    store = _load_devices()
    entry = store.get("devices", {}).get(device_id)
    if not entry:
        return None
    if not secrets.compare_digest(str(entry.get("token", "")), device_token):
        return None
    return entry


def _load_commands() -> dict[str, Any]:
    path = _commands_path()
    if not path.is_file():
        return {"queue": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"queue": {}}
    if not isinstance(data, dict):
        return {"queue": {}}
    data.setdefault("queue", {})
    return data


def _save_commands(data: dict[str, Any]) -> None:
    _commands_path().write_text(json.dumps(data, indent=2), encoding="utf-8")


def _verify_operator_remote(
    x_biobase_remote_secret: str | None,
    authorization: str | None,
) -> None:
    if x_biobase_remote_secret and CLIENT_REMOTE_SECRET:
        if secrets.compare_digest(x_biobase_remote_secret, CLIENT_REMOTE_SECRET):
            return
    if authorization and authorization.startswith("Bearer ") and DASHBOARD_TOKEN:
        token = authorization[7:]
        if secrets.compare_digest(token, DASHBOARD_TOKEN):
            return
    if not CLIENT_REMOTE_SECRET and not DASHBOARD_TOKEN:
        raise HTTPException(status_code=503, detail="remote_commands_disabled")
    raise HTTPException(status_code=401, detail="remote_unauthorized")


def _queue_device_command(device_id: str, command: str) -> dict[str, Any]:
    cmd = command.strip().lower()
    if cmd not in VALID_DEVICE_COMMANDS:
        raise HTTPException(status_code=400, detail="invalid_command")
    store = _load_devices()
    if device_id not in store.get("devices", {}):
        raise HTTPException(status_code=404, detail="device_not_found")
    data = _load_commands()
    queue = data.setdefault("queue", {})
    pending = queue.setdefault(device_id, [])
    if not isinstance(pending, list):
        pending = []
        queue[device_id] = pending
    record = {
        "id": f"cmd_{uuid.uuid4().hex[:12]}",
        "command": cmd,
        "queuedAt": _utc_now(),
        "deliveredAt": None,
    }
    pending.append(record)
    _save_commands(data)
    return record


def _command_delivered_to_scope(entry: dict[str, Any], scope: str) -> bool:
    if scope == "watchdog":
        return bool(entry.get("deliveredToWatchdogAt"))
    if entry.get("deliveredToMainAt"):
        return True
    # Legacy single-consumer acks count as main delivery only.
    return bool(entry.get("deliveredAt"))


def _mark_command_delivered(entry: dict[str, Any], scope: str, now: str) -> None:
    if scope == "watchdog":
        entry["deliveredToWatchdogAt"] = now
        return
    entry["deliveredToMainAt"] = now
    entry["deliveredAt"] = now


def _scope_commands(scope: str) -> frozenset[str]:
    if scope == "watchdog":
        return WATCHDOG_SCOPE_COMMANDS
    return MAIN_SCOPE_COMMANDS


def _touch_device_heartbeat(
    device_id: str,
    *,
    app_version: str | None,
    hostname: str | None,
    scope: str,
    share_stats: bool | None = None,
    tracked_player: str | None = None,
) -> None:
    store = _load_devices()
    devices = store.setdefault("devices", {})
    entry = devices.get(device_id)
    if not isinstance(entry, dict):
        return
    now = _utc_now()
    entry["lastSeen"] = now
    entry["lastSeenScope"] = scope
    if app_version:
        entry["appVersion"] = app_version.strip()[:32]
    if hostname:
        entry["hostname"] = hostname.strip()[:80]
    if share_stats is not None:
        entry["shareStatsOnServer"] = share_stats
    if tracked_player is not None:
        entry["trackedPlayerName"] = tracked_player.strip()[:80]
    devices[device_id] = entry
    store["devices"] = devices
    _save_devices(store)


def _prune_presence_sessions() -> None:
    cutoff = datetime.now(timezone.utc).timestamp() - 120
    stale = [
        session_id
        for session_id, entry in _presence_sessions.items()
        if float(entry.get("_seenAt", 0)) < cutoff
    ]
    for session_id in stale:
        _presence_sessions.pop(session_id, None)


def _record_presence(body: ClientPresenceBody) -> None:
    _prune_presence_sessions()
    session_id = body.sessionId.strip()
    if not session_id:
        return
    if not body.shareStats:
        _presence_sessions.pop(session_id, None)
        return
    now = _utc_now()
    _presence_sessions[session_id] = {
        "sessionId": session_id,
        "deviceName": body.deviceName.strip()[:80] or "Biobase Client",
        "playerName": body.playerName.strip()[:80],
        "shareStats": True,
        "appVersion": body.appVersion.strip()[:32],
        "hostname": body.hostname.strip()[:80],
        "updatedAt": now,
        "_seenAt": datetime.now(timezone.utc).timestamp(),
    }
def _pull_device_commands(
    device_id: str,
    *,
    scope: str = "main",
    app_version: str | None = None,
    hostname: str | None = None,
    share_stats: bool | None = None,
    tracked_player: str | None = None,
) -> list[dict[str, Any]]:
    normalized_scope = scope.strip().lower() if scope else "main"
    if normalized_scope not in {"main", "watchdog"}:
        normalized_scope = "main"

    _touch_device_heartbeat(
        device_id,
        app_version=app_version,
        hostname=hostname,
        scope=normalized_scope,
        share_stats=share_stats,
        tracked_player=tracked_player,
    )

    allowed = _scope_commands(normalized_scope)
    data = _load_commands()
    queue = data.get("queue", {})
    pending = queue.get(device_id, [])
    if not isinstance(pending, list):
        pending = []
    undelivered: list[dict[str, Any]] = []
    now = _utc_now()
    changed = False
    for entry in pending:
        if not isinstance(entry, dict):
            continue
        command = str(entry.get("command", "")).strip().lower()
        if command not in allowed:
            continue
        if _command_delivered_to_scope(entry, normalized_scope):
            continue
        _mark_command_delivered(entry, normalized_scope, now)
        changed = True
        undelivered.append(
            {
                "id": entry.get("id"),
                "command": command,
                "queuedAt": entry.get("queuedAt"),
            }
        )
    if changed:
        queue[device_id] = pending
        data["queue"] = queue
        _save_commands(data)
    if normalized_scope == "watchdog":
        undelivered.sort(key=lambda entry: 0 if entry.get("command") == "kill_app" else 1)
    return undelivered


def register_client_routes(dashboard, control_url: str, control_headers_fn):
    start_movement_feed()

    @dashboard.get("/api/client/server/connect")
    def client_server_connect() -> JSONResponse:
        host = CS2_CONNECT_HOST
        port = CS2_CONNECT_PORT
        return JSONResponse(
            {
                "host": host,
                "port": port,
                "console": f"connect {host}:{port}",
            }
        )

    @dashboard.get("/api/client/live/status")
    def client_live_status() -> JSONResponse:
        try:
            r = httpx.get(f"{control_url}/api/status", headers=control_headers_fn(), timeout=15.0)
        except httpx.RequestError as exc:
            return JSONResponse(
                {
                    "ok": False,
                    "error": "control_unreachable",
                    "detail": str(exc)[:500],
                    "connect": {
                        "host": CS2_CONNECT_HOST,
                        "port": CS2_CONNECT_PORT,
                        "console": f"connect {CS2_CONNECT_HOST}:{CS2_CONNECT_PORT}",
                    },
                },
                status_code=502,
            )
        try:
            data = r.json()
        except Exception:
            data = {"error": "bad_json", "raw": (r.text or "")[:2000]}
        if not isinstance(data, dict):
            data = {"raw": data}
        merged = {
            **data,
            "ok": r.status_code == 200 and data.get("rcon_ok", True) is not False,
            "connect": {
                "host": CS2_CONNECT_HOST,
                "port": CS2_CONNECT_PORT,
                "console": f"connect {CS2_CONNECT_HOST}:{CS2_CONNECT_PORT}",
            },
            "polledAt": _utc_now(),
        }
        return JSONResponse(merged, status_code=200 if merged.get("ok") else 502)

    @dashboard.get("/api/client/live/movement")
    def client_live_movement(
        steamid: str | None = Query(None),
        player: str | None = Query(None),
    ) -> JSONResponse:
        snapshot = get_movement_snapshot(steamid=steamid, player=player)
        return JSONResponse(snapshot, status_code=200)

    @dashboard.post("/api/client/live/presence")
    async def client_live_presence(body: ClientPresenceBody) -> JSONResponse:
        _record_presence(body)
        return JSONResponse({"ok": True, "recorded": body.shareStats})

    @dashboard.post("/api/client/companion/link")
    async def client_companion_create_link(body: CompanionLinkBody) -> JSONResponse:
        player_name = body.playerName.strip()
        payload = _create_companion_link(
            player_name=player_name,
            steamid=body.steamid,
            device_name=body.deviceName,
        )
        return JSONResponse(payload)

    @dashboard.get("/api/client/companion/resolve/{code}")
    def client_companion_resolve(code: str) -> JSONResponse:
        resolved = _resolve_companion_link(code)
        if not resolved:
            raise HTTPException(status_code=404, detail="companion_code_not_found")
        return JSONResponse(resolved)

    @dashboard.post("/api/client/device/pair")
    async def client_device_pair(body: ClientPairBody) -> JSONResponse:
        code = body.pairingCode.strip().replace(" ", "").upper()
        if not CLIENT_PAIRING_CODE:
            raise HTTPException(status_code=503, detail="pairing_disabled")
        if not code or not secrets.compare_digest(code, CLIENT_PAIRING_CODE):
            raise HTTPException(status_code=401, detail="invalid_pairing_code")
        device_id = f"dev_{uuid.uuid4().hex[:16]}"
        device_token = secrets.token_urlsafe(32)
        store = _load_devices()
        devices = store.setdefault("devices", {})
        devices[device_id] = {
            "token": device_token,
            "deviceName": body.deviceName.strip()[:80] or "Biobase Client",
            "serverName": body.serverName.strip()[:80] or "Biobase CS2",
            "appVersion": body.appVersion.strip()[:32],
            "pairedAt": _utc_now(),
        }
        _save_devices(store)
        return JSONResponse(
            {
                "deviceId": device_id,
                "deviceToken": device_token,
                "accountName": body.deviceName.strip()[:80] or "Biobase Player",
            }
        )

    @dashboard.post("/api/client/sessions")
    async def client_upload_session(
        request: Request,
        x_biobase_device_id: str | None = Header(None, alias="X-Biobase-Device-Id"),
        x_biobase_device_token: str | None = Header(None, alias="X-Biobase-Device-Token"),
    ) -> JSONResponse:
        device = _verify_device(x_biobase_device_id, x_biobase_device_token)
        if not device:
            raise HTTPException(status_code=401, detail="device_not_paired")
        raw = await request.body()
        if len(raw) > 2 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="session_payload_too_large")
        try:
            payload = json.loads(raw)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="invalid_json") from exc
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="session_payload_must_be_object")
        stored = _session_store().insert(
            device_id=x_biobase_device_id or "",
            device_name=str(device.get("deviceName") or ""),
            payload=payload,
        )
        return JSONResponse({"ok": True, "stored": True, "session": stored})

    @dashboard.get("/api/client/sessions")
    def client_list_sessions(
        limit: int = Query(20, ge=1, le=100),
        x_biobase_device_id: str | None = Header(None, alias="X-Biobase-Device-Id"),
        x_biobase_device_token: str | None = Header(None, alias="X-Biobase-Device-Token"),
    ) -> JSONResponse:
        device = _verify_device(x_biobase_device_id, x_biobase_device_token)
        if not device:
            raise HTTPException(status_code=401, detail="device_not_paired")
        sessions = _session_store().list_for_device(x_biobase_device_id or "", limit)
        return JSONResponse({"ok": True, "sessions": sessions})

    @dashboard.get("/api/client/device/commands")
    def client_device_commands_poll(
        scope: str = Query("main"),
        x_biobase_device_id: str | None = Header(None, alias="X-Biobase-Device-Id"),
        x_biobase_device_token: str | None = Header(None, alias="X-Biobase-Device-Token"),
        x_biobase_app_version: str | None = Header(None, alias="X-Biobase-App-Version"),
        x_biobase_hostname: str | None = Header(None, alias="X-Biobase-Hostname"),
        x_biobase_share_stats: str | None = Header(None, alias="X-Biobase-Share-Stats"),
        x_biobase_tracked_player: str | None = Header(None, alias="X-Biobase-Tracked-Player"),
    ) -> JSONResponse:
        device = _verify_device(x_biobase_device_id, x_biobase_device_token)
        if not device:
            raise HTTPException(status_code=401, detail="device_not_paired")
        share_stats: bool | None = None
        if x_biobase_share_stats is not None:
            share_stats = x_biobase_share_stats.strip().lower() not in {"0", "false", "no", "off"}
        commands = _pull_device_commands(
            x_biobase_device_id or "",
            scope=scope,
            app_version=x_biobase_app_version,
            hostname=x_biobase_hostname,
            share_stats=share_stats,
            tracked_player=x_biobase_tracked_player,
        )
        return JSONResponse({"ok": True, "scope": scope.strip().lower() or "main", "commands": commands})

    @dashboard.post("/api/client/device/commands")
    async def client_device_commands_queue(
        body: ClientQueueCommandBody,
        authorization: str | None = Header(None),
        x_biobase_remote_secret: str | None = Header(None, alias="X-Biobase-Remote-Secret"),
    ) -> JSONResponse:
        _verify_operator_remote(x_biobase_remote_secret, authorization)
        record = _queue_device_command(body.deviceId.strip(), body.command)
        return JSONResponse({"ok": True, "queued": record})

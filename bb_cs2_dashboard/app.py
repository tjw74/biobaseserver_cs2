"""
bb_cs2_dashboard — admin UI + uploads. Talks to bb_cs2_control over HTTP only (no RCON).
Serves Vite-built SPA from ./static (shadcn dashboard).
"""

from __future__ import annotations

import asyncio
import logging
import mimetypes
import json
import os
import re
import secrets
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import UploadFile as StarletteUploadFile
from pydantic import BaseModel, Field, field_validator

from client_api import register_client_routes
from shadow_api import register_shadow_routes

logger = logging.getLogger(__name__)

CONTROL_URL = os.environ.get("CS2_CONTROL_URL", "http://bb_cs2_control:8765").rstrip("/")


def _resolve_control_token() -> str:
    """Prefer CS2_CONTROL_TOKEN; fall back to BB_CS2_CONTROL_TOKEN (same names bb_cs2_control reads)."""
    return (
        os.environ.get("CS2_CONTROL_TOKEN", "").strip()
        or os.environ.get("BB_CS2_CONTROL_TOKEN", "").strip()
    )


# Accept either compose-style CS2_CONTROL_TOKEN or BB_CS2_CONTROL_TOKEN.
CONTROL_TOKEN = _resolve_control_token()
DASHBOARD_TOKEN = os.environ.get("BB_CS2_DASHBOARD_TOKEN", "").strip()


def _parse_allowed_dashboard_usernames() -> tuple[str, ...]:
    raw = os.environ.get("BB_CS2_DASHBOARD_USER", "").strip()
    if not raw:
        return ()
    parts: list[str] = []
    for segment in raw.split(","):
        name = segment.strip()
        if name:
            parts.append(name)
    return tuple(parts)


# When non-empty: login username must match one of these (after trim). Comma-separated list.
DASHBOARD_ALLOWED_USERNAMES = _parse_allowed_dashboard_usernames()


def _clips_upload_dir() -> Path:
    """Resolve upload dir: BB_CLIPS_UPLOAD_DIR, then legacy CLIPS_DIR, else container /data/clips."""
    bb = os.environ.get("BB_CLIPS_UPLOAD_DIR", "").strip()
    if bb:
        return Path(bb).resolve()
    legacy = os.environ.get("CLIPS_DIR", "").strip()
    if legacy:
        return Path(legacy).resolve()
    return Path("/data/clips").resolve()


CLIPS_UPLOAD_DIR = _clips_upload_dir()
BB_CLIPS_VM_PATH = os.environ.get("BB_CLIPS_VM_PATH", "").strip()
logger.info(
    "clips upload directory (resolved): %s uid=%s vm_path_hint=%s",
    CLIPS_UPLOAD_DIR,
    os.getuid(),
    BB_CLIPS_VM_PATH or "(unset)",
)
if not os.access(CLIPS_UPLOAD_DIR, os.W_OK):
    logger.warning(
        "clips upload directory is not writable — uploads will fail until the host bind "
        "mount is writable by this user (e.g. chown/chmod on VM path; container runs as "
        "non-root). path=%s",
        CLIPS_UPLOAD_DIR,
    )
MAX_UPLOAD_MB = int(os.environ.get("BB_DASHBOARD_MAX_UPLOAD_MB", "512"))
DEMO_PARSE_MAX_MB = int(os.environ.get("BB_DEMO_PARSE_MAX_MB", "256"))
DEMO_PARSE_ALLOW_URL_FETCH = os.environ.get("BB_DEMO_PARSE_ALLOW_URL_FETCH", "").lower() in (
    "1",
    "true",
    "yes",
)
# Comma-separated host suffixes (e.g. figshare.com matches ndownloader.files.figshare.com).
_DEMO_URL_HOSTS_RAW = os.environ.get(
    "BB_DEMO_PARSE_URL_HOSTS",
    "figshare.com,github.com,raw.githubusercontent.com,objects.githubusercontent.com",
)
DEMO_PARSE_URL_HOST_SUFFIXES = tuple(
    h.strip().lower().lstrip(".") for h in _DEMO_URL_HOSTS_RAW.split(",") if h.strip()
)
DEMO_PARSER_PROBE_TIMEOUT_SEC = float(os.environ.get("BB_DEMO_PARSER_PROBE_TIMEOUT_SEC", "3"))

# Routes that consume these parsers — echoed for Overview tooling clarity.
_DEMO_PARSER_API_SOURCE = "POST /api/demo-parse-preview · POST /api/demo-parser-compare"


def _probe_wheel_version(pkg: str, timeout_sec: float) -> str:
    cmd = ["import importlib.metadata as m", f"print(m.version({pkg!r}))"]
    try:
        p = subprocess.run(
            [sys.executable, "-c", "\n".join(cmd)],
            capture_output=True,
            text=True,
            timeout=max(0.2, timeout_sec),
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return "unknown"
    line = ((p.stdout or "").strip().split("\n") or [""])[0].strip()
    if p.returncode != 0 or not line:
        return "unknown"
    return line[:120]


def _probe_demoinfocs_summary_version(timeout_sec: float) -> str:
    pinned = os.environ.get("BB_DEMOINFOCS_SUMMARY_VERSION", "").strip()
    if pinned:
        return pinned[:320]
    go_bin = os.environ.get("BB_DEMOINFOCS_SUMMARY_BIN", "/usr/local/bin/demoinfocs-summary").strip()
    exe: str | None = None
    pth = Path(go_bin)
    if pth.is_file() and os.access(pth, os.X_OK):
        exe = str(pth)
    else:
        w = shutil.which(go_bin if "/" not in go_bin else Path(go_bin).name)
        if w:
            exe = w
        elif pth.is_file():
            exe = str(pth)
    if not exe:
        return "unknown"
    try:
        p = subprocess.run(
            [exe, "--version"],
            capture_output=True,
            text=True,
            timeout=max(0.2, timeout_sec),
        )
        out = "\n".join(s for s in [(p.stdout or "").strip(), (p.stderr or "").strip()] if s)
        line = out.split("\n")[0].strip() if out else ""
        if p.returncode == 0 and line:
            return line[:320]
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        pass
    return "unknown"


def collect_demo_parser_capabilities() -> list[dict[str, str]]:
    """Cheap runtime probe for Overview; timeouts are capped; failures become 'unknown'."""
    tout = DEMO_PARSER_PROBE_TIMEOUT_SEC
    return [
        {
            "id": "awpy",
            "tool": "awpy",
            "version_or_probe": _probe_wheel_version("awpy", tout),
            "source": _DEMO_PARSER_API_SOURCE,
        },
        {
            "id": "demoparser2",
            "tool": "demoparser2",
            "version_or_probe": _probe_wheel_version("demoparser2", tout),
            "source": _DEMO_PARSER_API_SOURCE,
        },
        {
            "id": "demoinfocs_golang",
            "tool": "demoinfocs-golang",
            "version_or_probe": _probe_demoinfocs_summary_version(tout),
            "source": _DEMO_PARSER_API_SOURCE,
        },
    ]


# Set true behind HTTPS (e.g. Caddy) so the session cookie is not sent over plain HTTP.
COOKIE_SECURE = os.environ.get("BB_DASHBOARD_COOKIE_SECURE", "").lower() in ("1", "true", "yes")
# When non-empty, dashboard lives under this URL prefix (e.g. /admin). Must match Vite build base.
DASHBOARD_ROOT_PATH = os.environ.get("BB_DASHBOARD_ROOT_PATH", "").strip().rstrip("/")
AUTH_COOKIE_PATH = DASHBOARD_ROOT_PATH if DASHBOARD_ROOT_PATH else "/"

AUTH_COOKIE = "bb_cs2_dashboard_auth"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 days

STATIC = Path(__file__).resolve().parent / "static"
COMPANION_STATIC = Path(__file__).resolve().parent / "static_companion"
dashboard = FastAPI(title="bb_cs2_dashboard", version="0.3.0")

_UNSAFE_NAME = re.compile(r"[^a-zA-Z0-9._-]+")
_CLIP_UUID_PREFIX = re.compile(r"^[0-9a-f]{32}_(.+)$")


def _clip_display_name(storage_name: str) -> str:
    m = _CLIP_UUID_PREFIX.match(storage_name)
    if m:
        return m.group(1)
    return storage_name


def _resolve_stored_clip_file(storage_name: str, *, root: Path | None = None) -> Path:
    """Resolve a basename under the clips directory; raise HTTPException on traversal or missing file."""
    raw = storage_name.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="missing_filename")
    base = Path(raw).name
    if base != raw or base in (".", ".."):
        raise HTTPException(status_code=400, detail="bad_filename")
    base_dir = (root if root is not None else CLIPS_UPLOAD_DIR).resolve()
    candidate = base_dir / base
    try:
        path = candidate.resolve()
    except OSError as e:
        raise HTTPException(status_code=404, detail="not_found") from e
    try:
        if not path.is_file():
            raise HTTPException(status_code=404, detail="not_found")
        if not path.is_relative_to(base_dir):
            raise HTTPException(status_code=400, detail="bad_filename")
    except HTTPException:
        raise
    except OSError as e:
        raise HTTPException(status_code=404, detail="not_found") from e
    return path


def _http_exception_message(exc: HTTPException) -> str:
    d = exc.detail
    if isinstance(d, str):
        return d
    if isinstance(d, list) and d:
        row = d[0]
        if isinstance(row, dict):
            msg = row.get("msg")
            if isinstance(msg, str):
                return msg
    return str(d)


async def _save_one_clip_upload(file: UploadFile) -> tuple[str, int]:
    """Stream one multipart upload into CLIPS_UPLOAD_DIR with UUID-prefixed name; enforce per-file size limit."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="missing_filename")
    safe = _UNSAFE_NAME.sub("_", Path(file.filename).name)[:200]
    if not safe or safe in (".", ".."):
        raise HTTPException(status_code=400, detail="bad_filename")
    dest_name = f"{uuid.uuid4().hex}_{safe}"
    dest = CLIPS_UPLOAD_DIR / dest_name
    CLIPS_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    max_bytes = MAX_UPLOAD_MB * 1024 * 1024
    written = 0
    try:
        with dest.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="file_too_large")
                out.write(chunk)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise
    except OSError as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=str(e)[:200]) from e
    return dest_name, written


def _list_clip_uploads(*, root: Path | None = None) -> list[dict[str, str | int]]:
    base_dir = (root if root is not None else CLIPS_UPLOAD_DIR).resolve()
    if not base_dir.is_dir():
        return []
    items: list[dict[str, str | int]] = []
    try:
        for p in base_dir.iterdir():
            if not p.is_file():
                continue
            name = p.name
            if name.startswith("."):
                continue
            try:
                rp = p.resolve()
                if not rp.is_relative_to(base_dir):
                    continue
                st = p.stat()
            except OSError:
                continue
            mime, _enc = mimetypes.guess_type(name)
            modified = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc)
            items.append(
                {
                    "name": name,
                    "display_name": _clip_display_name(name),
                    "bytes": int(st.st_size),
                    "modified_unix": int(st.st_mtime),
                    "modified_iso": modified.isoformat(),
                    "content_type": mime or "application/octet-stream",
                }
            )
    except OSError:
        return []
    items.sort(key=lambda r: int(r["modified_unix"]), reverse=True)
    return items


_CLIP_LIBRARY_ID = re.compile(r"^[a-zA-Z0-9._-]+$")


def _resolve_clip_library_dir(library_id: str, *, root: Path | None = None) -> Path:
    """Resolve a subdirectory under the clips upload dir (e.g. klingis_tv_tiktok)."""
    lid = library_id.strip()
    if not lid or not _CLIP_LIBRARY_ID.match(lid):
        raise HTTPException(status_code=400, detail="bad_library_id")
    base_dir = (root if root is not None else CLIPS_UPLOAD_DIR).resolve()
    candidate = (base_dir / lid).resolve()
    try:
        if not candidate.is_dir() or not candidate.is_relative_to(base_dir):
            raise HTTPException(status_code=404, detail="library_not_found")
    except HTTPException:
        raise
    except OSError as e:
        raise HTTPException(status_code=404, detail="library_not_found") from e
    return candidate


def _resolve_clip_in_library(library_id: str, file_name: str, *, root: Path | None = None) -> Path:
    """Resolve a basename inside a clip library folder."""
    raw = file_name.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="missing_filename")
    base = Path(raw).name
    if base != raw or base in (".", ".."):
        raise HTTPException(status_code=400, detail="bad_filename")
    lib_dir = _resolve_clip_library_dir(library_id, root=root)
    candidate = lib_dir / base
    try:
        path = candidate.resolve()
        if not path.is_file() or not path.is_relative_to(lib_dir):
            raise HTTPException(status_code=404, detail="not_found")
    except HTTPException:
        raise
    except OSError as e:
        raise HTTPException(status_code=404, detail="not_found") from e
    return path


def _list_clip_libraries(*, root: Path | None = None) -> list[dict[str, str | int]]:
    base_dir = (root if root is not None else CLIPS_UPLOAD_DIR).resolve()
    if not base_dir.is_dir():
        return []
    libraries: list[dict[str, str | int]] = []
    try:
        for p in base_dir.iterdir():
            if not p.is_dir() or p.name.startswith("."):
                continue
            if not _CLIP_LIBRARY_ID.match(p.name):
                continue
            try:
                rp = p.resolve()
                if not rp.is_relative_to(base_dir):
                    continue
            except OSError:
                continue
            mp4_count = 0
            try:
                for child in p.iterdir():
                    if child.is_file() and child.name.lower().endswith(".mp4"):
                        mp4_count += 1
            except OSError:
                continue
            if mp4_count <= 0:
                continue
            libraries.append({"id": p.name, "label": p.name, "mp4_count": mp4_count})
    except OSError:
        return []
    libraries.sort(key=lambda row: str(row["id"]).lower())
    return libraries


def _list_clip_library_items(
    library_id: str,
    *,
    limit: int = 50,
    offset: int = 0,
    q: str | None = None,
    root: Path | None = None,
) -> dict[str, object]:
    lib_dir = _resolve_clip_library_dir(library_id, root=root)
    q_norm = q.strip().lower() if q else ""
    items: list[dict[str, str | int]] = []
    try:
        for p in lib_dir.iterdir():
            if not p.is_file() or not p.name.lower().endswith(".mp4"):
                continue
            if q_norm and q_norm not in p.name.lower():
                continue
            try:
                rp = p.resolve()
                if not rp.is_relative_to(lib_dir):
                    continue
                st = p.stat()
            except OSError:
                continue
            mime, _enc = mimetypes.guess_type(p.name)
            modified = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc)
            items.append(
                {
                    "name": p.name,
                    "display_name": p.name,
                    "bytes": int(st.st_size),
                    "modified_unix": int(st.st_mtime),
                    "modified_iso": modified.isoformat(),
                    "content_type": mime or "video/mp4",
                }
            )
    except OSError:
        items = []
    items.sort(key=lambda r: int(r["modified_unix"]), reverse=True)
    total = len(items)
    page_limit = max(1, min(int(limit), 200))
    page_offset = max(0, int(offset))
    page = items[page_offset : page_offset + page_limit]
    return {
        "library_id": library_id,
        "items": page,
        "total": total,
        "limit": page_limit,
        "offset": page_offset,
        "has_more": page_offset + page_limit < total,
    }


class LoginBody(BaseModel):
    username: str = ""
    password: str = ""
    token: str = ""

    def effective_password(self) -> str:
        return (self.password or self.token or "").strip()


class MapChangeBody(BaseModel):
    map: str = Field(..., min_length=1, max_length=96)

    @field_validator("map")
    @classmethod
    def map_trim(cls, v: str) -> str:
        return v.strip()


def _tokens_match(received: str, expected: str) -> bool:
    if len(received) != len(expected):
        return False
    return secrets.compare_digest(received.encode("utf-8"), expected.encode("utf-8"))


def _request_authenticated(
    request: Request,
    authorization: str | None,
    x_dashboard_key: str | None,
) -> bool:
    if not DASHBOARD_TOKEN:
        return True
    cookie = request.cookies.get(AUTH_COOKIE)
    if cookie is not None and _tokens_match(cookie, DASHBOARD_TOKEN):
        return True
    if x_dashboard_key is not None and _tokens_match(x_dashboard_key, DASHBOARD_TOKEN):
        return True
    if authorization and authorization.startswith("Bearer ") and _tokens_match(
        authorization[7:],
        DASHBOARD_TOKEN,
    ):
        return True
    return False


def _demo_host_allowed(host: str) -> bool:
    h = host.lower().strip(".")
    for suf in DEMO_PARSE_URL_HOST_SUFFIXES:
        if h == suf or h.endswith("." + suf):
            return True
    return False


def _validate_demo_fetch_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("https", "http"):
        raise HTTPException(status_code=400, detail="demo_url_scheme_not_allowed")
    host = (parsed.hostname or "").lower()
    if not host:
        raise HTTPException(status_code=400, detail="demo_url_missing_host")
    if parsed.scheme == "http" and host not in ("127.0.0.1", "localhost"):
        raise HTTPException(status_code=400, detail="demo_url_http_only_localhost")
    if not _demo_host_allowed(host):
        raise HTTPException(status_code=400, detail="demo_url_host_not_allowed")
    if not parsed.path and not parsed.netloc:
        raise HTTPException(status_code=400, detail="demo_url_invalid")
    return url.strip()


async def _stream_download_demo(url: str, dest: Path, max_bytes: int) -> None:
    timeout = httpx.Timeout(120.0, connect=30.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        async with client.stream("GET", url) as resp:
            if resp.status_code >= 400:
                raise HTTPException(
                    status_code=502,
                    detail=f"demo_url_fetch_failed:{resp.status_code}",
                )
            written = 0
            with dest.open("wb") as out:
                async for chunk in resp.aiter_bytes():
                    written += len(chunk)
                    if written > max_bytes:
                        raise HTTPException(status_code=413, detail="demo_url_too_large")
                    out.write(chunk)


async def _resolve_demo_multipart_input(
    *,
    file: UploadFile | None,
    demo_url: str | None,
    clip_storage_name: str | None,
) -> tuple[Path, Path | None, str]:
    """Return (parse_path, tmp_path_or_none, source_name). Caller deletes tmp_path after use."""
    has_file = bool(file and file.filename)
    url_raw = (demo_url or "").strip()
    clip_raw = (clip_storage_name or "").strip()
    n_sources = int(has_file) + int(bool(url_raw)) + int(bool(clip_raw))
    if n_sources > 1:
        raise HTTPException(
            status_code=400,
            detail="provide_only_one_of_file_demo_url_or_clip_storage_name",
        )
    if n_sources == 0:
        raise HTTPException(status_code=400, detail="missing_file_demo_url_or_clip_storage_name")

    max_bytes = DEMO_PARSE_MAX_MB * 1024 * 1024
    tmp_path: Path | None = None
    parse_path: Path | None = None
    source_name = "demo.dem"

    if clip_raw:
        path = _resolve_stored_clip_file(clip_raw)
        if not path.name.lower().endswith(".dem"):
            raise HTTPException(status_code=400, detail="clip_expected_dem_extension")
        st_sz = path.stat().st_size
        if st_sz > max_bytes:
            raise HTTPException(status_code=413, detail="file_too_large")
        parse_path = path
        source_name = _clip_display_name(path.name)
    elif has_file:
        assert file is not None
        if not file.filename or not str(file.filename).lower().endswith(".dem"):
            raise HTTPException(status_code=400, detail="expected_dem_extension")
        source_name = _UNSAFE_NAME.sub("_", Path(file.filename).name)[:200]
        tmp = tempfile.NamedTemporaryFile(suffix=".dem", delete=False)
        tmp_path = Path(tmp.name)
        written = 0
        try:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise HTTPException(status_code=413, detail="file_too_large")
                tmp.write(chunk)
        finally:
            tmp.close()
        parse_path = tmp_path
    else:
        if not DEMO_PARSE_ALLOW_URL_FETCH:
            raise HTTPException(
                status_code=403,
                detail="demo_url_disabled_set_BB_DEMO_PARSE_ALLOW_URL_FETCH",
            )
        validated = _validate_demo_fetch_url(url_raw)
        derived_name = Path(urlparse(validated).path).name
        if derived_name.lower().endswith(".dem"):
            source_name = _UNSAFE_NAME.sub("_", derived_name)[:200]
        tmp = tempfile.NamedTemporaryFile(suffix=".dem", delete=False)
        tmp_path = Path(tmp.name)
        tmp.close()
        await _stream_download_demo(validated, tmp_path, max_bytes)
        parse_path = tmp_path

    assert parse_path is not None
    if parse_path.stat().st_size < 4096:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="demo_too_small_bytes")

    return parse_path, tmp_path, source_name


def require_dashboard_auth(
    request: Request,
    authorization: str | None = None,
    x_dashboard_key: str | None = None,
) -> None:
    if not _request_authenticated(request, authorization, x_dashboard_key):
        raise HTTPException(status_code=401, detail="Unauthorized")


def _control_headers() -> dict[str, str]:
    h: dict[str, str] = {}
    if CONTROL_TOKEN:
        h["X-Api-Key"] = CONTROL_TOKEN
    return h


register_client_routes(dashboard, CONTROL_URL, _control_headers)
register_shadow_routes(dashboard)


@dashboard.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "bb_cs2_dashboard"}


@dashboard.get("/api/auth/me")
def auth_me(request: Request) -> dict[str, bool]:
    if not DASHBOARD_TOKEN:
        return {"authenticated": True, "login_required": False}
    cookie = request.cookies.get(AUTH_COOKIE)
    ok = cookie is not None and _tokens_match(cookie, DASHBOARD_TOKEN)
    return {"authenticated": ok, "login_required": True}


@dashboard.post("/api/auth/login")
def auth_login(body: LoginBody) -> JSONResponse:
    if not DASHBOARD_TOKEN:
        return JSONResponse({"ok": True})
    pwd = body.effective_password()
    user_ok = True
    if DASHBOARD_ALLOWED_USERNAMES:
        u_in = body.username.strip()
        user_ok = any(_tokens_match(u_in, allowed) for allowed in DASHBOARD_ALLOWED_USERNAMES)
    pass_ok = bool(pwd) and _tokens_match(pwd, DASHBOARD_TOKEN)
    if not user_ok or not pass_ok:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    resp = JSONResponse({"ok": True})
    resp.set_cookie(
        AUTH_COOKIE,
        DASHBOARD_TOKEN,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        path=AUTH_COOKIE_PATH,
    )
    return resp


@dashboard.post("/api/auth/logout")
def auth_logout() -> JSONResponse:
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(
        AUTH_COOKIE,
        path=AUTH_COOKIE_PATH,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
    )
    return resp


@dashboard.get("/api/demo-extractable-fields")
def api_demo_extractable_fields(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
) -> JSONResponse:
    """Catalog of demo fields surfaced by awpy/demoparser2 (see demo_field_catalog)."""
    require_dashboard_auth(request, authorization, x_dashboard_key)
    try:
        from demo_field_catalog import build_catalog

        return JSONResponse(build_catalog())
    except ImportError as e:
        logger.exception("demo catalog import failed")
        return JSONResponse(
            {
                "error": "catalog_unavailable",
                "detail": str(e),
                "fields": [],
                "meta": {
                    "extraction": None,
                    "awpy_version": None,
                    "demoparser2_version": None,
                    "disclaimer": "Install awpy in this image (see bb_cs2_dashboard/requirements.txt).",
                },
            },
            status_code=503,
        )


@dashboard.post("/api/demo-parse-preview")
async def api_demo_parse_preview(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
    file: UploadFile | None = File(None),
    demo_url: str | None = Form(None),
    clip_storage_name: str | None = Form(None),
    event_scan_max: int = Form(80),
) -> JSONResponse:
    """
    Parse a .dem with awpy: upload `file`, or `demo_url` (when allowed), or `clip_storage_name`
    (basename under the clips upload dir from GET /api/uploads).
    """
    require_dashboard_auth(request, authorization, x_dashboard_key)
    scan_cap = max(0, min(int(event_scan_max), 200))

    tmp_path: Path | None = None
    try:
        parse_path, tmp_path, source_name = await _resolve_demo_multipart_input(
            file=file,
            demo_url=demo_url,
            clip_storage_name=clip_storage_name,
        )

        try:
            from demo_parse_preview import build_discovery_from_path

            result = await asyncio.to_thread(
                build_discovery_from_path,
                parse_path,
                source_filename=source_name,
                event_scan_max=scan_cap,
            )
        except ImportError as e:
            logger.exception("demo parse preview import failed")
            return JSONResponse(
                {
                    "error": "awpy_unavailable",
                    "detail": str(e),
                    "meta": {
                        "disclaimer": "Install awpy in this image (bb_cs2_dashboard/requirements.txt).",
                    },
                },
                status_code=503,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except FileNotFoundError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            logger.exception("demo parse failed")
            return JSONResponse(
                {"error": "parse_failed", "detail": str(e)[:1200]},
                status_code=422,
            )
        return JSONResponse(result)
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)


@dashboard.post("/api/demo-parser-compare")
async def api_demo_parser_compare(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
    file: UploadFile | None = File(None),
    demo_url: str | None = Form(None),
    clip_storage_name: str | None = Form(None),
) -> JSONResponse:
    """
    Run awpy, demoparser2 (LaihoE), and demoinfocs-golang summary subprocesses for one .dem source.
    Same multipart inputs as /api/demo-parse-preview.
    """
    require_dashboard_auth(request, authorization, x_dashboard_key)
    tmp_path: Path | None = None
    try:
        parse_path, tmp_path, source_name = await _resolve_demo_multipart_input(
            file=file,
            demo_url=demo_url,
            clip_storage_name=clip_storage_name,
        )
        try:
            from demo_parser_compare import build_parser_compare

            result = await asyncio.to_thread(
                build_parser_compare,
                parse_path,
                source_filename=source_name,
            )
        except ImportError as e:
            logger.exception("demo parser compare import failed")
            return JSONResponse(
                {
                    "error": "compare_unavailable",
                    "detail": str(e),
                },
                status_code=503,
            )
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            logger.exception("demo parser compare failed")
            return JSONResponse(
                {"error": "compare_failed", "detail": str(e)[:1200]},
                status_code=422,
            )
        return JSONResponse(result)
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)


DEMO_MOVEMENT_DIR = CLIPS_UPLOAD_DIR / ".parsed_movement"
DEMO_LABELS_DIR = CLIPS_UPLOAD_DIR / ".movement_labels"
DEMO_RENDERS_DIR = CLIPS_UPLOAD_DIR / ".demo_renders"
DEMO_RENDER_COMMAND = os.environ.get("BB_DEMO_RENDER_COMMAND", "").strip()
DEMO_STEAM_PLAYBACK_COMMAND = os.environ.get("BB_DEMO_STEAM_PLAYBACK_COMMAND", "").strip()
DEMO_STEAM_VIEWER_URL = os.environ.get("BB_DEMO_STEAM_VIEWER_URL", "http://192.168.1.120:6080/vnc.html?autoconnect=1&resize=remote&path=websockify").strip()


class DemoMovementAnnotationIn(BaseModel):
    id: str | None = None
    clip_storage_name: str
    player_steamid: str | None = None
    player_name: str | None = None
    start_tick: int = Field(ge=0)
    end_tick: int = Field(ge=0)
    label: str = Field(min_length=1, max_length=80)
    intent: str | None = Field(default=None, max_length=80)
    phase: str | None = Field(default=None, max_length=80)
    quality: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("label", "intent", "phase", "quality", "note", mode="before")
    @classmethod
    def _strip_text(cls, v: object) -> object:
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v


def _demo_movement_artifact_path(demo_path: Path) -> Path:
    from demo_movement import artifact_name_for_demo

    return DEMO_MOVEMENT_DIR / artifact_name_for_demo(demo_path)


def _demo_labels_path(demo_path: Path) -> Path:
    return DEMO_LABELS_DIR / _demo_movement_artifact_path(demo_path).name.replace(".movement.json", ".labels.json")


def _demo_render_path(demo_path: Path) -> Path:
    return DEMO_RENDERS_DIR / _demo_movement_artifact_path(demo_path).name.replace(".movement.json", ".mp4")


def _demo_render_meta_path(demo_path: Path) -> Path:
    return _demo_render_path(demo_path).with_suffix(".json")


def _render_public_url(demo_path: Path) -> str | None:
    mp4 = _demo_render_path(demo_path)
    if not mp4.is_file():
        return None
    return f"/api/demo-render/video?clip_storage_name={demo_path.name}"


def _read_render_meta(demo_path: Path) -> dict:
    meta_path = _demo_render_meta_path(demo_path)
    if meta_path.is_file():
        try:
            payload = json.loads(meta_path.read_text())
            if isinstance(payload, dict):
                return payload
        except json.JSONDecodeError:
            pass
    mp4 = _demo_render_path(demo_path)
    return {
        "ok": True,
        "storage_name": demo_path.name,
        "rendered": mp4.is_file(),
        "video_url": _render_public_url(demo_path),
        "bytes": mp4.stat().st_size if mp4.is_file() else None,
        "renderer_configured": bool(DEMO_RENDER_COMMAND),
        "steam_playback_configured": bool(DEMO_STEAM_PLAYBACK_COMMAND),
        "status": "ready" if mp4.is_file() else ("renderer_configured" if DEMO_RENDER_COMMAND else "renderer_missing"),
    }


def _read_steam_playback_meta(demo_path: Path) -> dict:
    return {
        "ok": True,
        "storage_name": demo_path.name,
        "steam_playback_configured": bool(DEMO_STEAM_PLAYBACK_COMMAND),
        "viewer_url": DEMO_STEAM_VIEWER_URL or None,
        "status": "steam_session_configured" if DEMO_STEAM_PLAYBACK_COMMAND else "steam_session_missing",
        "detail": (
            "Player Steam playback is configured. The dashboard can hand this demo to the logged-in Steam/CS2 session."
            if DEMO_STEAM_PLAYBACK_COMMAND
            else "Player Steam playback needs a logged-in Steam desktop/session on the render host. Configure BB_DEMO_STEAM_PLAYBACK_COMMAND; do not put Steam credentials in the dashboard."
        ),
    }


def _read_demo_labels(path: Path, *, storage_name: str) -> dict:
    if not path.is_file():
        return {"ok": True, "storage_name": storage_name, "annotations": []}
    try:
        payload = json.loads(path.read_text())
    except json.JSONDecodeError:
        logger.warning("bad labels artifact %s", path)
        return {"ok": True, "storage_name": storage_name, "annotations": []}
    annotations = payload.get("annotations")
    if not isinstance(annotations, list):
        annotations = []
    return {"ok": True, "storage_name": storage_name, "annotations": annotations, "updated_at": payload.get("updated_at")}


def _write_demo_labels(path: Path, *, storage_name: str, annotations: list[dict]) -> dict:
    payload = {
        "ok": True,
        "storage_name": storage_name,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "annotations": sorted(annotations, key=lambda x: (int(x.get("start_tick") or 0), str(x.get("label") or ""))),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")))
    tmp.replace(path)
    return payload


def _list_demo_movement_artifacts() -> list[dict[str, str | int | float | bool | None]]:
    rows: list[dict[str, str | int | float | bool | None]] = []
    if not DEMO_MOVEMENT_DIR.is_dir():
        return rows
    from demo_movement import read_artifact

    for p in sorted(DEMO_MOVEMENT_DIR.glob("*.movement.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            payload = read_artifact(p)
            meta = payload.get("meta") or {}
            summary = payload.get("summary") or {}
            st = p.stat()
            rows.append(
                {
                    "artifact": p.name,
                    "storage_name": meta.get("storage_name"),
                    "source_filename": meta.get("source_filename"),
                    "generated_at": meta.get("generated_at"),
                    "parse_elapsed_sec": meta.get("parse_elapsed_sec"),
                    "tick_rows": summary.get("tick_rows"),
                    "movement_rows": summary.get("movement_rows"),
                    "players": summary.get("players"),
                    "rounds": summary.get("rounds"),
                    "bytes": st.st_size,
                }
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("bad movement artifact %s: %s", p, e)
    return rows


@dashboard.get("/api/demo-movement")
def api_demo_movement_get(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
    clip_storage_name: str | None = None,
) -> JSONResponse:
    """Return existing parsed movement artifact for a clip, or list available artifacts."""
    require_dashboard_auth(request, authorization, x_dashboard_key)
    clip = (clip_storage_name or "").strip()
    if not clip:
        demos = [x for x in _list_clip_uploads() if str(x.get("name", "")).lower().endswith(".dem")]
        parsed = _list_demo_movement_artifacts()
        parsed_names = {str(x.get("storage_name")) for x in parsed if x.get("storage_name")}
        return JSONResponse(
            {
                "ok": True,
                "demos": [{**d, "movement_parsed": d.get("name") in parsed_names} for d in demos],
                "artifacts": parsed,
                "parse_max_mb": DEMO_PARSE_MAX_MB,
            }
        )

    demo_path = _resolve_stored_clip_file(clip)
    if not demo_path.name.lower().endswith(".dem"):
        raise HTTPException(status_code=400, detail="clip_expected_dem_extension")
    artifact = _demo_movement_artifact_path(demo_path)
    if not artifact.is_file():
        raise HTTPException(status_code=404, detail="movement_artifact_not_found_parse_first")
    from demo_movement import read_artifact

    return JSONResponse(read_artifact(artifact))


@dashboard.post("/api/demo-movement/parse")
async def api_demo_movement_parse(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
    clip_storage_name: str = Form(...),
    force: bool = Form(False),
    max_points_per_player: int = Form(450),
) -> JSONResponse:
    """Parse an uploaded .dem into a compact movement artifact for browser display."""
    require_dashboard_auth(request, authorization, x_dashboard_key)
    demo_path = _resolve_stored_clip_file(clip_storage_name)
    if not demo_path.name.lower().endswith(".dem"):
        raise HTTPException(status_code=400, detail="clip_expected_dem_extension")
    nbytes = demo_path.stat().st_size
    max_bytes = DEMO_PARSE_MAX_MB * 1024 * 1024
    if nbytes > max_bytes:
        raise HTTPException(status_code=413, detail="file_too_large")
    artifact = _demo_movement_artifact_path(demo_path)
    if artifact.is_file() and not force:
        from demo_movement import read_artifact

        payload = read_artifact(artifact)
        payload["cached"] = True
        return JSONResponse(payload)

    max_points = max(50, min(int(max_points_per_player), 1500))
    try:
        from demo_movement import build_movement_artifact, write_artifact

        payload = await asyncio.to_thread(
            build_movement_artifact,
            demo_path,
            source_filename=_clip_display_name(demo_path.name),
            storage_name=demo_path.name,
            max_points_per_player=max_points,
        )
        await asyncio.to_thread(write_artifact, payload, artifact)
        payload["cached"] = False
        return JSONResponse(payload)
    except Exception as e:  # noqa: BLE001
        logger.exception("demo movement parse failed")
        return JSONResponse({"error": "movement_parse_failed", "detail": str(e)[:1200]}, status_code=422)


@dashboard.get("/api/demo-render")
def api_demo_render_get(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
    clip_storage_name: str | None = None,
) -> JSONResponse:
    """Return full-render MP4 status for an uploaded demo."""
    require_dashboard_auth(request, authorization, x_dashboard_key)
    clip = (clip_storage_name or "").strip()
    if not clip:
        raise HTTPException(status_code=400, detail="clip_storage_name_required")
    demo_path = _resolve_stored_clip_file(clip)
    if not demo_path.name.lower().endswith(".dem"):
        raise HTTPException(status_code=400, detail="clip_expected_dem_extension")
    return JSONResponse(_read_render_meta(demo_path))


@dashboard.get("/api/demo-render/video")
def api_demo_render_video(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
    clip_storage_name: str | None = None,
) -> FileResponse:
    """Serve a cached rendered MP4 for browser playback."""
    require_dashboard_auth(request, authorization, x_dashboard_key)
    clip = (clip_storage_name or "").strip()
    if not clip:
        raise HTTPException(status_code=400, detail="clip_storage_name_required")
    demo_path = _resolve_stored_clip_file(clip)
    mp4 = _demo_render_path(demo_path)
    if not mp4.is_file():
        raise HTTPException(status_code=404, detail="render_not_found")
    return FileResponse(mp4, media_type="video/mp4", filename=mp4.name)


@dashboard.get("/api/demo-steam-playback")
def api_demo_steam_playback_get(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
    clip_storage_name: str | None = None,
) -> JSONResponse:
    """Return player-owned Steam session playback status for an uploaded demo."""
    require_dashboard_auth(request, authorization, x_dashboard_key)
    clip = (clip_storage_name or "").strip()
    if not clip:
        raise HTTPException(status_code=400, detail="clip_storage_name_required")
    demo_path = _resolve_stored_clip_file(clip)
    if not demo_path.name.lower().endswith(".dem"):
        raise HTTPException(status_code=400, detail="clip_expected_dem_extension")
    return JSONResponse(_read_steam_playback_meta(demo_path))


@dashboard.post("/api/demo-steam-playback")
async def api_demo_steam_playback_post(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
    clip_storage_name: str = Form(...),
) -> JSONResponse:
    """Hand an uploaded demo to a logged-in player Steam/CS2 session without storing credentials."""
    require_dashboard_auth(request, authorization, x_dashboard_key)
    demo_path = _resolve_stored_clip_file(clip_storage_name)
    if not demo_path.name.lower().endswith(".dem"):
        raise HTTPException(status_code=400, detail="clip_expected_dem_extension")
    if not DEMO_STEAM_PLAYBACK_COMMAND:
        payload = _read_steam_playback_meta(demo_path)
        payload["ok"] = False
        return JSONResponse(payload, status_code=503)
    cmd = DEMO_STEAM_PLAYBACK_COMMAND.format(
        demo=shlex.quote(str(demo_path)),
        storage_name=shlex.quote(demo_path.name),
    )
    try:
        proc = await asyncio.to_thread(subprocess.run, cmd, shell=True, capture_output=True, text=True, timeout=45)
    except subprocess.TimeoutExpired:
        return JSONResponse({"ok": False, "status": "steam_playback_timeout", "detail": "Steam playback handoff exceeded 45s."}, status_code=504)
    if proc.returncode != 0:
        return JSONResponse(
            {
                "ok": False,
                "status": "steam_playback_failed",
                "steam_playback_configured": True,
                "exit_code": proc.returncode,
                "stdout": (proc.stdout or "")[-2000:],
                "stderr": (proc.stderr or "")[-4000:],
            },
            status_code=422,
        )
    return JSONResponse(
        {
            "ok": True,
            "storage_name": demo_path.name,
            "steam_playback_configured": True,
            "viewer_url": DEMO_STEAM_VIEWER_URL or None,
            "status": "steam_playback_started",
            "detail": "Demo handed to the configured logged-in Steam/CS2 session.",
            "stdout": (proc.stdout or "")[-2000:],
            "stderr": (proc.stderr or "")[-2000:],
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
    )


@dashboard.post("/api/demo-render")
async def api_demo_render_post(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
    clip_storage_name: str = Form(...),
    force: bool = Form(False),
) -> JSONResponse:
    """Run configured full-demo renderer and cache an MP4 artifact."""
    require_dashboard_auth(request, authorization, x_dashboard_key)
    demo_path = _resolve_stored_clip_file(clip_storage_name)
    if not demo_path.name.lower().endswith(".dem"):
        raise HTTPException(status_code=400, detail="clip_expected_dem_extension")
    mp4 = _demo_render_path(demo_path)
    meta_path = _demo_render_meta_path(demo_path)
    if mp4.is_file() and not force:
        payload = _read_render_meta(demo_path)
        payload["cached"] = True
        return JSONResponse(payload)
    if not DEMO_RENDER_COMMAND:
        return JSONResponse(
            {
                "ok": False,
                "rendered": False,
                "renderer_configured": False,
                "status": "renderer_missing",
                "detail": "Full CS2 demo rendering requires a CS2 game client/render worker. Set BB_DEMO_RENDER_COMMAND with {demo} and {output} placeholders, or place an MP4 artifact in .demo_renders.",
            },
            status_code=503,
        )
    mp4.parent.mkdir(parents=True, exist_ok=True)
    tmp = mp4.with_suffix(".tmp.mp4")
    cmd = DEMO_RENDER_COMMAND.format(demo=shlex.quote(str(demo_path)), output=shlex.quote(str(tmp)))
    started = datetime.now(timezone.utc)
    try:
        proc = await asyncio.to_thread(subprocess.run, cmd, shell=True, capture_output=True, text=True, timeout=3600)
    except subprocess.TimeoutExpired:
        return JSONResponse({"ok": False, "status": "render_timeout", "detail": "Renderer exceeded 3600s."}, status_code=504)
    if proc.returncode != 0 or not tmp.is_file():
        return JSONResponse(
            {
                "ok": False,
                "status": "render_failed",
                "exit_code": proc.returncode,
                "stdout": (proc.stdout or "")[-2000:],
                "stderr": (proc.stderr or "")[-4000:],
            },
            status_code=422,
        )
    tmp.replace(mp4)
    payload = {
        "ok": True,
        "storage_name": demo_path.name,
        "rendered": True,
        "renderer_configured": True,
        "status": "ready",
        "video_url": _render_public_url(demo_path),
        "bytes": mp4.stat().st_size,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "started_at": started.isoformat(),
    }
    meta_path.write_text(json.dumps(payload, separators=(",", ":")))
    return JSONResponse(payload)


@dashboard.get("/api/demo-movement/annotations")
def api_demo_movement_annotations_get(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
    clip_storage_name: str | None = None,
) -> JSONResponse:
    """Return manual pro-review labels for one uploaded demo."""
    require_dashboard_auth(request, authorization, x_dashboard_key)
    clip = (clip_storage_name or "").strip()
    if not clip:
        raise HTTPException(status_code=400, detail="clip_storage_name_required")
    demo_path = _resolve_stored_clip_file(clip)
    if not demo_path.name.lower().endswith(".dem"):
        raise HTTPException(status_code=400, detail="clip_expected_dem_extension")
    return JSONResponse(_read_demo_labels(_demo_labels_path(demo_path), storage_name=demo_path.name))


@dashboard.post("/api/demo-movement/annotations")
def api_demo_movement_annotations_post(
    body: DemoMovementAnnotationIn,
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
) -> JSONResponse:
    """Create or update one manual pro-review label for a tick range."""
    require_dashboard_auth(request, authorization, x_dashboard_key)
    demo_path = _resolve_stored_clip_file(body.clip_storage_name)
    if not demo_path.name.lower().endswith(".dem"):
        raise HTTPException(status_code=400, detail="clip_expected_dem_extension")
    start_tick = min(body.start_tick, body.end_tick)
    end_tick = max(body.start_tick, body.end_tick)
    path = _demo_labels_path(demo_path)
    payload = _read_demo_labels(path, storage_name=demo_path.name)
    annotations = [x for x in payload.get("annotations", []) if isinstance(x, dict)]
    annotation_id = (body.id or secrets.token_urlsafe(8)).strip()
    row = {
        "id": annotation_id,
        "clip_storage_name": demo_path.name,
        "player_steamid": body.player_steamid,
        "player_name": body.player_name,
        "start_tick": start_tick,
        "end_tick": end_tick,
        "label": body.label.strip(),
        "intent": body.intent,
        "phase": body.phase,
        "quality": body.quality,
        "note": body.note,
        "created_at": next((x.get("created_at") for x in annotations if x.get("id") == annotation_id), None) or datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    annotations = [x for x in annotations if x.get("id") != annotation_id]
    annotations.append(row)
    return JSONResponse(_write_demo_labels(path, storage_name=demo_path.name, annotations=annotations))


@dashboard.delete("/api/demo-movement/annotations/{annotation_id}")
def api_demo_movement_annotations_delete(
    annotation_id: str,
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
    clip_storage_name: str | None = None,
) -> JSONResponse:
    require_dashboard_auth(request, authorization, x_dashboard_key)
    clip = (clip_storage_name or "").strip()
    if not clip:
        raise HTTPException(status_code=400, detail="clip_storage_name_required")
    demo_path = _resolve_stored_clip_file(clip)
    path = _demo_labels_path(demo_path)
    payload = _read_demo_labels(path, storage_name=demo_path.name)
    annotations = [x for x in payload.get("annotations", []) if isinstance(x, dict) and x.get("id") != annotation_id]
    return JSONResponse(_write_demo_labels(path, storage_name=demo_path.name, annotations=annotations))


@dashboard.get("/api/server-capabilities")
def api_server_capabilities(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
) -> JSONResponse:
    """Aggregate CS2 server stack hints (RCON probes + env passthrough on bb_cs2_control)."""
    require_dashboard_auth(request, authorization, x_dashboard_key)
    demo_parsers = collect_demo_parser_capabilities()
    try:
        r = httpx.get(
            f"{CONTROL_URL}/api/capabilities",
            headers=_control_headers(),
            timeout=25.0,
        )
    except httpx.RequestError as e:
        return JSONResponse(
            {
                "error": "control_unreachable",
                "control_http_ok": False,
                "detail": str(e)[:500],
                "checked_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "demo_parsers": demo_parsers,
            },
            status_code=502,
        )
    try:
        data = r.json()
    except Exception:
        return JSONResponse(
            {
                "error": "bad_json",
                "control_http_ok": False,
                "raw": (r.text or "")[:2000],
                "demo_parsers": demo_parsers,
            },
            status_code=502,
        )
    if not isinstance(data, dict):
        return JSONResponse(
            {
                "error": "bad_json",
                "control_http_ok": False,
                "demo_parsers": demo_parsers,
            },
            status_code=502,
        )
    merged = {
        **data,
        "control_http_ok": 200 <= r.status_code < 400,
        "demo_parsers": demo_parsers,
    }
    return JSONResponse(merged, status_code=r.status_code if r.status_code < 500 else 502)


@dashboard.get("/api/status")
def api_status(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
) -> JSONResponse:
    require_dashboard_auth(request, authorization, x_dashboard_key)
    try:
        r = httpx.get(f"{CONTROL_URL}/api/status", headers=_control_headers(), timeout=30.0)
    except httpx.RequestError as e:
        return JSONResponse(
            {"error": "control_unreachable", "detail": str(e)[:500]},
            status_code=502,
        )
    try:
        data = r.json()
    except Exception:
        data = {"error": "bad_json", "raw": (r.text or "")[:2000]}
    return JSONResponse(data, status_code=r.status_code if 200 <= r.status_code < 500 else 502)


@dashboard.post("/api/bots/start")
def api_bots_start(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
) -> JSONResponse:
    require_dashboard_auth(request, authorization, x_dashboard_key)
    try:
        r = httpx.post(
            f"{CONTROL_URL}/api/bots/start",
            headers=_control_headers(),
            timeout=60.0,
        )
    except httpx.RequestError as e:
        return JSONResponse({"ok": False, "error": str(e)[:500]}, status_code=502)
    try:
        data = r.json()
    except Exception:
        data = {"ok": False, "raw": (r.text or "")[:2000]}
    return JSONResponse(data, status_code=r.status_code)


@dashboard.post("/api/bots/stop")
def api_bots_stop(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
) -> JSONResponse:
    require_dashboard_auth(request, authorization, x_dashboard_key)
    try:
        r = httpx.post(
            f"{CONTROL_URL}/api/bots/stop",
            headers=_control_headers(),
            timeout=60.0,
        )
    except httpx.RequestError as e:
        return JSONResponse({"ok": False, "error": str(e)[:500]}, status_code=502)
    try:
        data = r.json()
    except Exception:
        data = {"ok": False, "raw": (r.text or "")[:2000]}
    return JSONResponse(data, status_code=r.status_code)


@dashboard.post("/api/map")
def api_map_change(
    request: Request,
    body: MapChangeBody,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
) -> JSONResponse:
    require_dashboard_auth(request, authorization, x_dashboard_key)
    hdr = {**_control_headers(), "Content-Type": "application/json"}
    try:
        r = httpx.post(
            f"{CONTROL_URL}/api/map",
            headers=hdr,
            json={"map": body.map},
            timeout=60.0,
        )
    except httpx.RequestError as e:
        return JSONResponse({"ok": False, "error": str(e)[:500]}, status_code=502)
    try:
        data = r.json()
    except Exception:
        data = {"ok": False, "raw": (r.text or "")[:2000]}
    # Control auth uses a different token; don't surface as dashboard session 401.
    if r.status_code == 401:
        return JSONResponse(
            {
                "ok": False,
                "error": "Control API rejected the key — set BB_CS2_CONTROL_TOKEN the same on bb_cs2_control and dashboard (CS2_CONTROL_TOKEN).",
            },
            status_code=502,
        )
    if r.status_code == 404:
        return JSONResponse(
            {
                "ok": False,
                "error": "Control has no /api/map — rebuild & recreate bb_cs2_control (docker compose build bb_cs2_control && up -d).",
            },
            status_code=502,
        )
    return JSONResponse(data, status_code=r.status_code)


@dashboard.get("/api/clip-libraries")
@dashboard.get("/api/clip-libraries/")
def api_clip_libraries_list(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
) -> JSONResponse:
    require_dashboard_auth(request, authorization, x_dashboard_key)
    libraries = _list_clip_libraries()
    return JSONResponse({"ok": True, "libraries": libraries})


@dashboard.get("/api/clip-libraries/{library_id}/items")
def api_clip_library_items(
    request: Request,
    library_id: str,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
    limit: int = 50,
    offset: int = 0,
    q: str | None = None,
) -> JSONResponse:
    require_dashboard_auth(request, authorization, x_dashboard_key)
    payload = _list_clip_library_items(library_id, limit=limit, offset=offset, q=q)
    return JSONResponse({"ok": True, **payload})


@dashboard.get("/api/clip-libraries/{library_id}/play")
def api_clip_library_play(
    request: Request,
    library_id: str,
    name: str,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
) -> FileResponse:
    require_dashboard_auth(request, authorization, x_dashboard_key)
    path = _resolve_clip_in_library(library_id, name)
    return FileResponse(path, media_type="video/mp4", filename=path.name)


@dashboard.get("/api/uploads")
@dashboard.get("/api/uploads/")
def api_uploads_list(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
) -> JSONResponse:
    require_dashboard_auth(request, authorization, x_dashboard_key)
    items = _list_clip_uploads()
    return JSONResponse({"ok": True, "items": items, "vm_clips_path": BB_CLIPS_VM_PATH or None})


@dashboard.get("/api/uploads/download/{storage_name}")
def api_uploads_download(
    request: Request,
    storage_name: str,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
) -> FileResponse:
    require_dashboard_auth(request, authorization, x_dashboard_key)
    path = _resolve_stored_clip_file(storage_name)
    basename = path.name
    media = mimetypes.guess_type(basename)[0] or "application/octet-stream"
    return FileResponse(
        path,
        media_type=media,
        filename=_clip_display_name(basename),
    )


@dashboard.post("/api/uploads")
@dashboard.post("/api/uploads/")
async def api_uploads(
    request: Request,
    authorization: str | None = Header(None),
    x_dashboard_key: str | None = Header(None, alias="X-Dashboard-Key"),
) -> JSONResponse:
    require_dashboard_auth(request, authorization, x_dashboard_key)
    form = await request.form()
    incoming: list[UploadFile] = []
    for key in ("file", "files", "files[]"):
        for item in form.getlist(key):
            # request.form() returns starlette.datastructures.UploadFile instances;
            # fastapi.UploadFile is a subclass, so checking only FastAPI class drops
            # valid multipart file parts and reports missing_file.
            if isinstance(item, StarletteUploadFile):
                incoming.append(item)
    if not incoming:
        raise HTTPException(status_code=400, detail="missing_file")

    vm = BB_CLIPS_VM_PATH or None
    host = socket.gethostname()

    if len(incoming) == 1:
        dest_name, written = await _save_one_clip_upload(incoming[0])
        return JSONResponse(
            {
                "ok": True,
                "saved_as": dest_name,
                "bytes": written,
                "vm_clips_path": vm,
                "host": host,
            }
        )

    results: list[dict[str, str | int | bool]] = []
    for uf in incoming:
        label = Path(uf.filename).name if uf.filename else ""
        try:
            dest_name, written = await _save_one_clip_upload(uf)
            row: dict[str, str | int | bool] = {
                "ok": True,
                "saved_as": dest_name,
                "bytes": written,
            }
            if label:
                row["filename"] = label
            results.append(row)
        except HTTPException as e:
            err_row: dict[str, str | int | bool] = {
                "ok": False,
                "detail": _http_exception_message(e),
                "http_status": e.status_code,
            }
            if label:
                err_row["filename"] = label
            results.append(err_row)
        except OSError as e:
            err_row = {
                "ok": False,
                "detail": str(e)[:200],
                "http_status": 500,
            }
            if label:
                err_row["filename"] = label
            results.append(err_row)

    all_ok = all(bool(r.get("ok")) for r in results)
    return JSONResponse(
        {
            "ok": all_ok,
            "results": results,
            "vm_clips_path": vm,
            "host": host,
        }
    )


def _spa_index() -> FileResponse:
    p = STATIC / "index.html"
    if not p.is_file():
        raise HTTPException(
            status_code=500,
            detail="Dashboard UI missing — run frontend build (see Dockerfile).",
        )
    return FileResponse(p, media_type="text/html; charset=utf-8")


_assets_dir = STATIC / "assets"
if _assets_dir.is_dir():
    dashboard.mount(
        "/assets",
        StaticFiles(directory=_assets_dir),
        name="assets",
    )


@dashboard.get("/")
def index() -> FileResponse:
    return _spa_index()


@dashboard.get("/favicon.svg", include_in_schema=False)
def favicon() -> FileResponse:
    p = STATIC / "favicon.svg"
    if p.is_file():
        return FileResponse(p, media_type="image/svg+xml")
    raise HTTPException(status_code=404)


@dashboard.get("/{full_path:path}", include_in_schema=False)
def spa_fallback(full_path: str) -> FileResponse:
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not Found")
    if full_path.startswith("assets/"):
        raise HTTPException(status_code=404)
    candidate = STATIC / full_path
    if candidate.is_file() and candidate.resolve().is_relative_to(STATIC.resolve()):
        return FileResponse(candidate)
    return _spa_index()


def _companion_index() -> FileResponse:
    index_path = COMPANION_STATIC / "index.html"
    if not index_path.is_file():
        raise HTTPException(
            status_code=503,
            detail="Companion UI missing — run companion frontend build.",
        )
    return FileResponse(index_path, media_type="text/html; charset=utf-8")


def _mount_companion_routes(target: FastAPI) -> None:
    if not COMPANION_STATIC.is_dir():
        logger.warning("Companion static dir missing: %s", COMPANION_STATIC)
        return

    companion_assets = COMPANION_STATIC / "assets"
    companion_app = FastAPI(title="biobase_companion", include_in_schema=False)
    if companion_assets.is_dir():
        companion_app.mount(
            "/assets",
            StaticFiles(directory=companion_assets),
            name="companion_assets",
        )

    @companion_app.get("/")
    def companion_root() -> FileResponse:
        return _companion_index()

    @companion_app.get("/c/{code}")
    def companion_code_route(code: str) -> FileResponse:
        return _companion_index()

    @companion_app.get("/{full_path:path}")
    def companion_fallback(full_path: str) -> FileResponse:
        if full_path.startswith("assets/"):
            raise HTTPException(status_code=404)
        candidate = COMPANION_STATIC / full_path
        if candidate.is_file() and candidate.resolve().is_relative_to(COMPANION_STATIC.resolve()):
            return FileResponse(candidate)
        return _companion_index()

    target.mount("/companion", companion_app)

    @target.get("/c/{code}", include_in_schema=False)
    def companion_short_link(code: str) -> RedirectResponse:
        normalized = code.strip().upper()
        return RedirectResponse(url=f"/companion/c/{normalized}", status_code=302)


if DASHBOARD_ROOT_PATH:

    def _admin_redirect_trailing_slash() -> RedirectResponse:
        return RedirectResponse(url=f"{DASHBOARD_ROOT_PATH}/", status_code=307)

    app = FastAPI()
    app.add_api_route("/health", health, methods=["GET"], include_in_schema=False)
    app.add_api_route(
        DASHBOARD_ROOT_PATH,
        _admin_redirect_trailing_slash,
        methods=["GET"],
        include_in_schema=False,
    )
    app.mount(DASHBOARD_ROOT_PATH, dashboard)
    _mount_companion_routes(app)
else:
    app = dashboard
    _mount_companion_routes(app)

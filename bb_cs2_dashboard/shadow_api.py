"""Shadow Move capture, storage, comparison, and scoring API.

Uses SQLite (stdlib) for tick-level movement data. No external deps needed.
Schema mirrors the Postgres reference in bb_client/initdb/008_shadow_moves.sql.
"""

from __future__ import annotations

import json
import math
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# ── Database ──────────────────────────────────────────────────────

_SHADOW_DB: Path | None = None


def _db_path() -> Path:
    global _SHADOW_DB
    if _SHADOW_DB is None:
        base = Path(
            os.environ.get("BB_CLIENT_DATA_DIR", "/data/clips/.biobase_client")
        ).resolve()
        _SHADOW_DB = base / "shadow.db"
    return _SHADOW_DB


def _get_db() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS shadow_move (
    id                TEXT PRIMARY KEY,
    creator_user_id   TEXT DEFAULT '',
    creator_steam_id  TEXT DEFAULT '',
    name              TEXT NOT NULL,
    description       TEXT DEFAULT '',
    map_name          TEXT DEFAULT '',
    move_type         TEXT DEFAULT 'general',
    difficulty        TEXT DEFAULT 'medium',
    tags              TEXT DEFAULT '[]',
    start_tick        INTEGER DEFAULT 0,
    end_tick          INTEGER DEFAULT 0,
    duration_ticks    INTEGER DEFAULT 0,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    visibility        TEXT DEFAULT 'private',
    status            TEXT DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS shadow_move_tick (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    shadow_move_id  TEXT NOT NULL REFERENCES shadow_move(id) ON DELETE CASCADE,
    tick_offset     INTEGER NOT NULL,
    x               REAL NOT NULL,
    y               REAL NOT NULL,
    z               REAL NOT NULL,
    vel_x           REAL DEFAULT 0,
    vel_y           REAL DEFAULT 0,
    vel_z           REAL DEFAULT 0,
    speed           REAL DEFAULT 0,
    yaw             REAL DEFAULT 0,
    pitch           REAL DEFAULT 0,
    on_ground       INTEGER DEFAULT 1,
    ducking         INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_move_tick_move
    ON shadow_move_tick(shadow_move_id);
CREATE INDEX IF NOT EXISTS idx_move_tick_offset
    ON shadow_move_tick(shadow_move_id, tick_offset);

CREATE TABLE IF NOT EXISTS shadow_attempt (
    id              TEXT PRIMARY KEY,
    user_id         TEXT DEFAULT '',
    steam_id        TEXT DEFAULT '',
    shadow_move_id  TEXT NOT NULL REFERENCES shadow_move(id),
    started_at      TEXT NOT NULL,
    completed_at    TEXT,
    score_overall   REAL DEFAULT 0,
    score_path      REAL DEFAULT 0,
    score_speed     REAL DEFAULT 0,
    score_timing    REAL DEFAULT 0,
    status          TEXT DEFAULT 'completed'
);

CREATE INDEX IF NOT EXISTS idx_attempt_move
    ON shadow_attempt(shadow_move_id);

CREATE TABLE IF NOT EXISTS shadow_attempt_tick (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id  TEXT NOT NULL REFERENCES shadow_attempt(id) ON DELETE CASCADE,
    tick_offset INTEGER NOT NULL,
    x           REAL NOT NULL,
    y           REAL NOT NULL,
    z           REAL NOT NULL,
    vel_x       REAL DEFAULT 0,
    vel_y       REAL DEFAULT 0,
    vel_z       REAL DEFAULT 0,
    speed       REAL DEFAULT 0,
    yaw         REAL DEFAULT 0,
    pitch       REAL DEFAULT 0,
    on_ground   INTEGER DEFAULT 1,
    ducking     INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_attempt_tick_attempt
    ON shadow_attempt_tick(attempt_id);
CREATE INDEX IF NOT EXISTS idx_attempt_tick_offset
    ON shadow_attempt_tick(attempt_id, tick_offset);
"""


def _init_schema() -> None:
    db = _get_db()
    db.executescript(_SCHEMA_SQL)
    db.close()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ── Request models ────────────────────────────────────────────────


class TickData(BaseModel):
    tick_offset: int = 0
    x: float = 0
    y: float = 0
    z: float = 0
    vel_x: float = 0
    vel_y: float = 0
    vel_z: float = 0
    speed: float = 0
    yaw: float = 0
    pitch: float = 0
    on_ground: bool = True
    ducking: bool = False


class CreateMoveBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str = ""
    map_name: str = ""
    move_type: str = "general"
    difficulty: str = "medium"
    tags: list[str] = []
    creator_steam_id: str = ""
    ticks: list[TickData] = []


class UpdateMoveBody(BaseModel):
    name: str | None = None
    description: str | None = None
    difficulty: str | None = None
    tags: list[str] | None = None
    visibility: str | None = None


class CreateAttemptBody(BaseModel):
    steam_id: str = ""
    ticks: list[TickData] = []


# ── Scoring ───────────────────────────────────────────────────────


def _compute_scores(
    ref_ticks: list[dict[str, Any]], attempt_ticks: list[dict[str, Any]]
) -> dict[str, float]:
    if not ref_ticks or not attempt_ticks:
        return {"overall": 0, "path": 0, "speed": 0, "timing": 0}

    ref_by_tick: dict[int, dict[str, Any]] = {}
    for t in ref_ticks:
        ref_by_tick[t["tick_offset"]] = t
    ref_offsets = sorted(ref_by_tick.keys())

    path_errors: list[float] = []
    speed_errors: list[float] = []

    for at in attempt_ticks:
        offset = at["tick_offset"]
        closest = min(ref_offsets, key=lambda k: abs(k - offset))
        rt = ref_by_tick[closest]

        dx = at["x"] - rt["x"]
        dy = at["y"] - rt["y"]
        dz = at["z"] - rt["z"]
        dist = math.sqrt(dx * dx + dy * dy + dz * dz)
        path_errors.append(dist)

        speed_errors.append(abs(at["speed"] - rt["speed"]))

    avg_path = sum(path_errors) / len(path_errors)
    avg_speed = sum(speed_errors) / len(speed_errors)

    path_score = max(0.0, min(100.0, 100 * math.exp(-avg_path / 150)))
    speed_score = max(0.0, min(100.0, 100 * math.exp(-avg_speed / 75)))

    ref_dur = max((t["tick_offset"] for t in ref_ticks), default=1)
    att_dur = max((t["tick_offset"] for t in attempt_ticks), default=1)
    ratio = min(ref_dur, att_dur) / max(ref_dur, att_dur, 1)
    timing_score = ratio * 100

    overall = path_score * 0.5 + speed_score * 0.3 + timing_score * 0.2

    return {
        "overall": round(overall, 1),
        "path": round(path_score, 1),
        "speed": round(speed_score, 1),
        "timing": round(timing_score, 1),
    }


# ── Helpers ───────────────────────────────────────────────────────


def _row_to_move(row: sqlite3.Row, *, include_ticks: bool = False) -> dict[str, Any]:
    d = dict(row)
    d["tags"] = json.loads(d.get("tags") or "[]")
    if not include_ticks:
        d.pop("tags_raw", None)
    return d


def _load_ticks(db: sqlite3.Connection, move_id: str) -> list[dict[str, Any]]:
    rows = db.execute(
        "SELECT tick_offset, x, y, z, vel_x, vel_y, vel_z, speed, yaw, pitch, on_ground, ducking "
        "FROM shadow_move_tick WHERE shadow_move_id = ? ORDER BY tick_offset",
        (move_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def _load_attempt_ticks(db: sqlite3.Connection, attempt_id: str) -> list[dict[str, Any]]:
    rows = db.execute(
        "SELECT tick_offset, x, y, z, vel_x, vel_y, vel_z, speed, yaw, pitch, on_ground, ducking "
        "FROM shadow_attempt_tick WHERE attempt_id = ? ORDER BY tick_offset",
        (attempt_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def _insert_ticks(
    db: sqlite3.Connection,
    table: str,
    fk_col: str,
    fk_val: str,
    ticks: list[TickData],
) -> None:
    db.executemany(
        f"INSERT INTO {table} ({fk_col}, tick_offset, x, y, z, vel_x, vel_y, vel_z, "
        f"speed, yaw, pitch, on_ground, ducking) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
            (
                fk_val,
                t.tick_offset,
                t.x, t.y, t.z,
                t.vel_x, t.vel_y, t.vel_z,
                t.speed, t.yaw, t.pitch,
                int(t.on_ground), int(t.ducking),
            )
            for t in ticks
        ],
    )


# ── Route registration ───────────────────────────────────────────


def register_shadow_routes(app) -> None:  # noqa: C901
    _init_schema()

    # ── List moves ──

    @app.get("/api/shadow/moves")
    def list_shadow_moves(
        map_name: str = Query(""),
        difficulty: str = Query(""),
        move_type: str = Query(""),
        status: str = Query(""),
    ) -> JSONResponse:
        db = _get_db()
        clauses: list[str] = []
        params: list[str] = []
        if map_name:
            clauses.append("map_name = ?")
            params.append(map_name)
        if difficulty:
            clauses.append("difficulty = ?")
            params.append(difficulty)
        if move_type:
            clauses.append("move_type = ?")
            params.append(move_type)
        if status:
            clauses.append("status = ?")
            params.append(status)

        where = " AND ".join(clauses) if clauses else "1"
        rows = db.execute(
            f"SELECT * FROM shadow_move WHERE {where} ORDER BY created_at DESC",
            params,
        ).fetchall()

        moves = []
        for row in rows:
            m = _row_to_move(row)
            cnt = db.execute(
                "SELECT COUNT(*) as c FROM shadow_attempt WHERE shadow_move_id = ?",
                (m["id"],),
            ).fetchone()
            m["attempt_count"] = cnt["c"] if cnt else 0
            moves.append(m)

        db.close()
        return JSONResponse({"moves": moves})

    # ── Get move ──

    @app.get("/api/shadow/moves/{move_id}")
    def get_shadow_move(move_id: str) -> JSONResponse:
        db = _get_db()
        row = db.execute("SELECT * FROM shadow_move WHERE id = ?", (move_id,)).fetchone()
        if not row:
            db.close()
            raise HTTPException(404, "Move not found")
        m = _row_to_move(row, include_ticks=True)
        m["ticks"] = _load_ticks(db, move_id)
        cnt = db.execute(
            "SELECT COUNT(*) as c FROM shadow_attempt WHERE shadow_move_id = ?",
            (move_id,),
        ).fetchone()
        m["attempt_count"] = cnt["c"] if cnt else 0
        db.close()
        return JSONResponse(m)

    # ── Create move ──

    @app.post("/api/shadow/moves")
    def create_shadow_move(body: CreateMoveBody) -> JSONResponse:
        if not body.ticks:
            raise HTTPException(400, "At least one tick is required")

        move_id = str(uuid.uuid4())
        now = _utc_now()
        offsets = [t.tick_offset for t in body.ticks]
        duration = max(offsets) - min(offsets) if offsets else 0

        db = _get_db()
        db.execute(
            "INSERT INTO shadow_move "
            "(id, creator_steam_id, name, description, map_name, move_type, "
            "difficulty, tags, start_tick, end_tick, duration_ticks, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                move_id,
                body.creator_steam_id,
                body.name.strip()[:200],
                body.description.strip()[:2000],
                body.map_name.strip()[:64],
                body.move_type.strip()[:32],
                body.difficulty.strip()[:16],
                json.dumps(body.tags[:20]),
                min(offsets) if offsets else 0,
                max(offsets) if offsets else 0,
                duration,
                now,
                now,
            ),
        )
        _insert_ticks(db, "shadow_move_tick", "shadow_move_id", move_id, body.ticks)
        db.commit()

        row = db.execute("SELECT * FROM shadow_move WHERE id = ?", (move_id,)).fetchone()
        result = _row_to_move(row)
        result["ticks"] = _load_ticks(db, move_id)
        result["attempt_count"] = 0
        db.close()
        return JSONResponse(result, status_code=201)

    # ── Update move ──

    @app.patch("/api/shadow/moves/{move_id}")
    def update_shadow_move(move_id: str, body: UpdateMoveBody) -> JSONResponse:
        db = _get_db()
        row = db.execute("SELECT * FROM shadow_move WHERE id = ?", (move_id,)).fetchone()
        if not row:
            db.close()
            raise HTTPException(404, "Move not found")

        sets: list[str] = []
        params: list[Any] = []
        if body.name is not None:
            sets.append("name = ?")
            params.append(body.name.strip()[:200])
        if body.description is not None:
            sets.append("description = ?")
            params.append(body.description.strip()[:2000])
        if body.difficulty is not None:
            sets.append("difficulty = ?")
            params.append(body.difficulty.strip()[:16])
        if body.tags is not None:
            sets.append("tags = ?")
            params.append(json.dumps(body.tags[:20]))
        if body.visibility is not None:
            sets.append("visibility = ?")
            params.append(body.visibility.strip()[:16])

        if sets:
            sets.append("updated_at = ?")
            params.append(_utc_now())
            params.append(move_id)
            db.execute(
                f"UPDATE shadow_move SET {', '.join(sets)} WHERE id = ?", params
            )
            db.commit()

        row = db.execute("SELECT * FROM shadow_move WHERE id = ?", (move_id,)).fetchone()
        db.close()
        return JSONResponse(_row_to_move(row))

    # ── Delete move ──

    @app.delete("/api/shadow/moves/{move_id}")
    def delete_shadow_move(move_id: str) -> JSONResponse:
        db = _get_db()
        db.execute("DELETE FROM shadow_move WHERE id = ?", (move_id,))
        db.commit()
        db.close()
        return JSONResponse({"ok": True})

    # ── Publish move ──

    @app.post("/api/shadow/moves/{move_id}/publish")
    def publish_shadow_move(move_id: str) -> JSONResponse:
        db = _get_db()
        row = db.execute("SELECT * FROM shadow_move WHERE id = ?", (move_id,)).fetchone()
        if not row:
            db.close()
            raise HTTPException(404, "Move not found")
        db.execute(
            "UPDATE shadow_move SET status = 'published', visibility = 'public', updated_at = ? WHERE id = ?",
            (_utc_now(), move_id),
        )
        db.commit()
        row = db.execute("SELECT * FROM shadow_move WHERE id = ?", (move_id,)).fetchone()
        db.close()
        return JSONResponse(_row_to_move(row))

    # ── Create attempt ──

    @app.post("/api/shadow/moves/{move_id}/attempts")
    def create_shadow_attempt(move_id: str, body: CreateAttemptBody) -> JSONResponse:
        if not body.ticks:
            raise HTTPException(400, "At least one tick is required")

        db = _get_db()
        ref_row = db.execute("SELECT * FROM shadow_move WHERE id = ?", (move_id,)).fetchone()
        if not ref_row:
            db.close()
            raise HTTPException(404, "Move not found")

        ref_ticks = _load_ticks(db, move_id)

        attempt_id = str(uuid.uuid4())
        now = _utc_now()
        attempt_dicts = [t.model_dump() for t in body.ticks]
        scores = _compute_scores(ref_ticks, attempt_dicts)

        db.execute(
            "INSERT INTO shadow_attempt "
            "(id, steam_id, shadow_move_id, started_at, completed_at, "
            "score_overall, score_path, score_speed, score_timing, status) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                attempt_id,
                body.steam_id,
                move_id,
                now,
                now,
                scores["overall"],
                scores["path"],
                scores["speed"],
                scores["timing"],
                "completed",
            ),
        )
        _insert_ticks(db, "shadow_attempt_tick", "attempt_id", attempt_id, body.ticks)
        db.commit()

        result = {
            "id": attempt_id,
            "shadow_move_id": move_id,
            "steam_id": body.steam_id,
            "started_at": now,
            "completed_at": now,
            "score_overall": scores["overall"],
            "score_path": scores["path"],
            "score_speed": scores["speed"],
            "score_timing": scores["timing"],
            "status": "completed",
            "ticks": attempt_dicts,
            "ref_ticks": ref_ticks,
        }
        db.close()
        return JSONResponse(result, status_code=201)

    # ── List attempts ──

    @app.get("/api/shadow/moves/{move_id}/attempts")
    def list_shadow_attempts(move_id: str) -> JSONResponse:
        db = _get_db()
        rows = db.execute(
            "SELECT * FROM shadow_attempt WHERE shadow_move_id = ? ORDER BY started_at DESC",
            (move_id,),
        ).fetchall()
        db.close()
        return JSONResponse({"attempts": [dict(r) for r in rows]})

    # ── Get attempt ──

    @app.get("/api/shadow/attempts/{attempt_id}")
    def get_shadow_attempt(attempt_id: str) -> JSONResponse:
        db = _get_db()
        row = db.execute(
            "SELECT * FROM shadow_attempt WHERE id = ?", (attempt_id,)
        ).fetchone()
        if not row:
            db.close()
            raise HTTPException(404, "Attempt not found")

        result = dict(row)
        result["ticks"] = _load_attempt_ticks(db, attempt_id)
        result["ref_ticks"] = _load_ticks(db, result["shadow_move_id"])
        db.close()
        return JSONResponse(result)

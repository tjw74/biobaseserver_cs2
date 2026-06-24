"""Durable SQLite persistence for paired desktop-client performance sessions."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class ClientSessionStore:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir.resolve()
        self.db_path = self.data_dir / "client_sessions.sqlite3"

    def _connect(self) -> sqlite3.Connection:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(str(self.db_path), timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA foreign_keys=ON")
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS client_session (
                id TEXT PRIMARY KEY,
                device_id TEXT NOT NULL,
                device_name TEXT NOT NULL DEFAULT '',
                received_at TEXT NOT NULL,
                schema_version TEXT NOT NULL,
                payload_json TEXT NOT NULL
            )
            """
        )
        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_client_session_device_received
            ON client_session(device_id, received_at DESC)
            """
        )
        return db

    def insert(
        self,
        *,
        device_id: str,
        device_name: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        session_id = f"session_{uuid.uuid4().hex}"
        received_at = _utc_now()
        schema_version = str(
            payload.get("schemaVersion")
            or payload.get("version")
            or "legacy-1"
        )
        payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True)
        with self._connect() as db:
            db.execute(
                """
                INSERT INTO client_session
                    (id, device_id, device_name, received_at, schema_version, payload_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    device_id,
                    device_name[:80],
                    received_at,
                    schema_version[:64],
                    payload_json,
                ),
            )
        return {
            "id": session_id,
            "receivedAt": received_at,
            "schemaVersion": schema_version,
        }

    def list_for_device(self, device_id: str, limit: int = 20) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 100))
        with self._connect() as db:
            rows = db.execute(
                """
                SELECT id, device_id, device_name, received_at, schema_version, payload_json
                FROM client_session
                WHERE device_id = ?
                ORDER BY received_at DESC
                LIMIT ?
                """,
                (device_id, safe_limit),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "deviceId": row["device_id"],
                "deviceName": row["device_name"],
                "receivedAt": row["received_at"],
                "schemaVersion": row["schema_version"],
                "payload": json.loads(row["payload_json"]),
            }
            for row in rows
        ]

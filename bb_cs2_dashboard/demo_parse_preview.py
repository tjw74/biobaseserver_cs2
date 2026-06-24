"""
Parse a CS2 .dem with awpy/demoparser2 and return JSON-serializable *discovered* paths/columns
from that run (no invented field names).
"""

from __future__ import annotations

import hashlib
import importlib.metadata
from pathlib import Path
from typing import Any

import polars as pl


def _pkg_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def _meta_block(source_filename: str, file_bytes: int, sha256: str) -> dict[str, Any]:
    return {
        "extraction": "awpy.Demo + demoparser2.DemoParser (as wired by awpy 2.x)",
        "awpy_version": _pkg_version("awpy"),
        "demoparser2_version": _pkg_version("demoparser2"),
        "source_filename": source_filename,
        "bytes": file_bytes,
        "sha256": sha256,
        "disclaimer": (
            "Discovered keys/columns are for this demo file and this awpy/demoparser2 build only; "
            "game updates and other demos will differ. Deep `parse_event` scanning reads each game "
            "event type and may be slow on large demos."
        ),
    }


def _hash_file(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    n = 0
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
            n += len(chunk)
    return h.hexdigest(), n


def _pl_cols(df: pl.DataFrame | None) -> list[str]:
    if df is None:
        return []
    return [str(c) for c in df.columns]


def _rows_append(
    rows: list[dict[str, str]],
    *,
    group: str,
    key: str,
    detail: str = "",
) -> None:
    rows.append({"group": group, "key": key, "detail": detail})


def _scalar_preview(val: Any, *, max_str: int = 96) -> Any:
    """JSON-safe-ish preview of a header or small value (strings truncated)."""
    if val is None:
        return None
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        return val
    if isinstance(val, bytes):
        return f"<bytes len={len(val)}>"
    s = str(val)
    if len(s) > max_str:
        return s[: max_str - 1] + "…"
    return s


def _header_field_samples(header: Any, header_keys: list[str], *, max_keys: int = 64) -> dict[str, Any]:
    out: dict[str, Any] = {}
    get = getattr(header, "get", None)
    for k in header_keys[:max_keys]:
        raw = None
        if callable(get):
            raw = get(k)
        else:
            try:
                raw = header[k]
            except Exception:  # noqa: BLE001
                raw = None
        out[str(k)] = _scalar_preview(raw)
    return out


def build_discovery_from_path(
    path: Path,
    *,
    source_filename: str | None = None,
    event_scan_max: int = 80,
) -> dict[str, Any]:
    """Run awpy Demo.parse and demoparser2 introspection; return structured + flat rows."""
    from awpy.demo import Demo

    path = path.resolve()
    if not path.is_file():
        raise FileNotFoundError(str(path))

    nbytes = path.stat().st_size
    if nbytes < 4096:
        raise ValueError(f"demo_too_small_bytes:{nbytes}")

    sha256, _hashed_bytes = _hash_file(path)
    name = source_filename or path.name

    demo = Demo(path)
    parser = demo.parser

    game_events = list(parser.list_game_events())
    updated_fields = list(parser.list_updated_fields())
    header_keys = sorted(str(k) for k in demo.header.keys())

    demo.parse()

    rows: list[dict[str, str]] = []

    for k in header_keys:
        _rows_append(rows, group="header", key=f"header.{k}")

    for ev in game_events:
        _rows_append(rows, group="demoparser2", key=f"list_game_events::{ev}")

    for fld in updated_fields:
        _rows_append(rows, group="demoparser2", key=f"list_updated_fields::{fld}")

    cap = max(0, min(int(event_scan_max), 200))
    event_columns: dict[str, Any] = {}
    for ev in game_events[:cap]:
        try:
            pdf = parser.parse_event(ev)
            cols = [str(c) for c in pdf.columns]
            event_columns[ev] = cols
            for c in cols:
                _rows_append(rows, group="demoparser2.parse_event", key=f"{ev}.{c}")
        except Exception as e:  # noqa: BLE001 — surface parser errors per event
            err = str(e)[:240]
            event_columns[ev] = {"error": err}
            _rows_append(rows, group="demoparser2.parse_event", key=f"{ev}", detail=err)

    events_payload: dict[str, list[str]] = {}
    for ev_name, ev_df in demo.events.items():
        events_payload[ev_name] = _pl_cols(ev_df)
        for c in events_payload[ev_name]:
            _rows_append(rows, group="awpy.events", key=f"{ev_name}.{c}")

    ticks_cols = _pl_cols(demo.ticks)
    for c in ticks_cols:
        _rows_append(rows, group="awpy.ticks", key=c)

    rounds_cols = _pl_cols(demo.rounds)
    for c in rounds_cols:
        _rows_append(rows, group="awpy.rounds", key=c)

    grenades_cols = _pl_cols(demo.grenades)
    for c in grenades_cols:
        _rows_append(rows, group="awpy.grenades", key=c)

    derived: dict[str, Any] = {}
    for prop in (
        "infernos",
        "smokes",
        "kills",
        "damages",
        "footsteps",
        "shots",
        "bomb",
        "player_round_totals",
        "server_cvars",
    ):
        try:
            df = getattr(demo, prop)
            cols = _pl_cols(df)
            derived[prop] = {"columns": cols}
            for c in cols:
                _rows_append(rows, group=f"awpy.derived.{prop}", key=c)
        except Exception as e:  # noqa: BLE001
            derived[prop] = {"error": str(e)[:500]}

    rows.sort(key=lambda r: (r["group"], r["key"]))

    return {
        "meta": _meta_block(name, nbytes, sha256),
        "discovered": {
            "header_keys": header_keys,
            "header_field_samples": _header_field_samples(demo.header, header_keys),
            "list_game_events": game_events,
            "list_updated_fields": updated_fields,
            "event_columns_from_parse_event": event_columns,
            "awpy_events_tables": events_payload,
            "ticks_columns": ticks_cols,
            "rounds_columns": rounds_cols,
            "grenades_columns": grenades_cols,
            "derived_tables": derived,
        },
        "discovery_rows": rows,
    }

"""Extract compact player movement artifacts from CS2 demos for the admin dashboard."""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _pkg_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def hash_file(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    n = 0
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            n += len(chunk)
            h.update(chunk)
    return h.hexdigest(), n


def artifact_name_for_demo(path: Path) -> str:
    sha, _ = hash_file(path)
    safe_stem = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in path.stem)[:80]
    return f"{safe_stem}.{sha[:16]}.movement.json"


def _num(v: Any) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(x) or math.isinf(x):
        return None
    return x


def _sample_points(rows: list[dict[str, Any]], max_points: int) -> list[dict[str, Any]]:
    if len(rows) <= max_points:
        chosen = rows
    else:
        step = max(1, math.ceil(len(rows) / max_points))
        chosen = rows[::step]
        if chosen[-1] != rows[-1]:
            chosen.append(rows[-1])
    out: list[dict[str, Any]] = []
    for r in chosen:
        item: dict[str, Any] = {
            "tick": int(r.get("tick") or 0),
            "x": _num(r.get("X")),
            "y": _num(r.get("Y")),
            "z": _num(r.get("Z")),
        }
        if r.get("round_num") is not None:
            item["round_num"] = int(r.get("round_num") or 0)
        if r.get("health") is not None:
            item["health"] = _num(r.get("health"))
        out.append(item)
    return out


def build_movement_artifact(
    demo_path: Path,
    *,
    source_filename: str,
    storage_name: str,
    max_points_per_player: int = 450,
    top_players: int = 16,
) -> dict[str, Any]:
    """Parse a demo and return compact JSON: summaries + downsampled movement trails."""
    from awpy.demo import Demo
    import polars as pl

    started = time.time()
    sha, nbytes = hash_file(demo_path)
    demo = Demo(demo_path)
    demo.parse()
    ticks = demo.ticks
    if ticks is None or ticks.height == 0:
        raise ValueError("no_tick_rows")

    keep = [c for c in ["tick", "round_num", "steamid", "name", "team_name", "X", "Y", "Z", "health"] if c in ticks.columns]
    required = {"tick", "steamid", "name", "X", "Y", "Z"}
    missing = sorted(required - set(keep))
    if missing:
        raise ValueError(f"missing_movement_columns:{','.join(missing)}")

    t = ticks.select(keep).drop_nulls(["tick", "steamid", "X", "Y", "Z"]).sort(["steamid", "tick"])
    bounds_row = t.select(
        pl.col("X").min().alias("x_min"),
        pl.col("X").max().alias("x_max"),
        pl.col("Y").min().alias("y_min"),
        pl.col("Y").max().alias("y_max"),
        pl.col("Z").min().alias("z_min"),
        pl.col("Z").max().alias("z_max"),
    ).to_dicts()[0]

    with_steps = t.with_columns(
        (pl.col("X") - pl.col("X").shift(1).over("steamid")).alias("dx"),
        (pl.col("Y") - pl.col("Y").shift(1).over("steamid")).alias("dy"),
        (pl.col("Z") - pl.col("Z").shift(1).over("steamid")).alias("dz"),
    ).with_columns(
        ((pl.col("dx") ** 2 + pl.col("dy") ** 2 + pl.col("dz") ** 2).sqrt()).fill_null(0).alias("step_units")
    )

    group_keys = ["steamid", "name"]
    if "team_name" in with_steps.columns:
        group_keys.append("team_name")
    player_rows = (
        with_steps.group_by(group_keys)
        .agg(
            pl.len().alias("rows"),
            pl.col("tick").min().alias("first_tick"),
            pl.col("tick").max().alias("last_tick"),
            pl.col("step_units").sum().alias("travel_units"),
            pl.col("X").min().alias("x_min"),
            pl.col("X").max().alias("x_max"),
            pl.col("Y").min().alias("y_min"),
            pl.col("Y").max().alias("y_max"),
            pl.col("Z").min().alias("z_min"),
            pl.col("Z").max().alias("z_max"),
        )
        .sort("travel_units", descending=True)
        .head(top_players)
        .to_dicts()
    )

    players: list[dict[str, Any]] = []
    sample_cols = [c for c in ["tick", "round_num", "steamid", "name", "team_name", "X", "Y", "Z", "health"] if c in t.columns]
    for row in player_rows:
        sid = row["steamid"]
        name = str(row.get("name") or sid)
        pr = t.filter(pl.col("steamid") == sid).select(sample_cols).to_dicts()
        players.append(
            {
                "steamid": str(sid),
                "name": name,
                "team_name": row.get("team_name"),
                "rows": int(row.get("rows") or 0),
                "first_tick": int(row.get("first_tick") or 0),
                "last_tick": int(row.get("last_tick") or 0),
                "travel_units": round(float(row.get("travel_units") or 0), 1),
                "bounds": {k: _num(row.get(k)) for k in ["x_min", "x_max", "y_min", "y_max", "z_min", "z_max"]},
                "points": _sample_points(pr, max_points_per_player),
            }
        )

    rounds = 0
    if "round_num" in t.columns:
        rounds = int(t.select(pl.col("round_num").n_unique()).item() or 0)

    return {
        "ok": True,
        "meta": {
            "extraction": "awpy.Demo.parse movement ticks",
            "awpy_version": _pkg_version("awpy"),
            "demoparser2_version": _pkg_version("demoparser2"),
            "source_filename": source_filename,
            "storage_name": storage_name,
            "bytes": nbytes,
            "sha256": sha,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "parse_elapsed_sec": round(time.time() - started, 2),
            "max_points_per_player": max_points_per_player,
            "note": "Full tick table is reduced to per-player trails for browser display; parser retains tick/player position semantics.",
        },
        "summary": {
            "tick_rows": int(ticks.height),
            "movement_rows": int(t.height),
            "players": len(players),
            "rounds": rounds,
            "columns": keep,
            "bounds": {k: _num(v) for k, v in bounds_row.items()},
        },
        "players": players,
    }


def write_artifact(payload: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")))
    tmp.replace(path)


def read_artifact(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())

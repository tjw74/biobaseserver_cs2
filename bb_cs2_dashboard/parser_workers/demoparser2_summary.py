#!/usr/bin/env python3
"""Subprocess worker: print one-line JSON summary from demoparser2 (LaihoE, CS2)."""
from __future__ import annotations

import importlib.metadata
import json
import sys
from pathlib import Path


def _pkg_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"parser": "demoparser2", "ok": False, "error": "missing_demo_path"}))
        sys.exit(2)
    path = Path(sys.argv[1])
    if not path.is_file():
        print(json.dumps({"parser": "demoparser2", "ok": False, "error": "demo_not_found"}))
        sys.exit(1)
    try:
        from demoparser2 import DemoParser

        parser = DemoParser(str(path))
        game_events = list(parser.list_game_events())
        death_rows: int | None = None
        death_error: str | None = None
        try:
            pdf = parser.parse_event("player_death")
            death_rows = int(len(pdf))
        except Exception as e:  # noqa: BLE001
            death_error = str(e)[:500]
        payload = {
            "parser": "demoparser2",
            "ok": True,
            "versions": {"demoparser2": _pkg_version("demoparser2")},
            "summary": {
                "game_events_count": len(game_events),
                "player_death_rows": death_rows,
                "player_death_error": death_error,
                "sample_events_head": game_events[:12],
            },
        }
        print(json.dumps(payload))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"parser": "demoparser2", "ok": False, "error": str(e)[:800]}))
        sys.exit(1)


if __name__ == "__main__":
    main()

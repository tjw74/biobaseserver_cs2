#!/usr/bin/env python3
"""Subprocess worker: print one-line JSON summary from awpy (CS2)."""
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
        print(json.dumps({"parser": "awpy", "ok": False, "error": "missing_demo_path"}))
        sys.exit(2)
    path = Path(sys.argv[1])
    if not path.is_file():
        print(json.dumps({"parser": "awpy", "ok": False, "error": "demo_not_found"}))
        sys.exit(1)
    try:
        from awpy.demo import Demo

        demo = Demo(path)
        demo.parse()
        ticks = demo.ticks
        kills = demo.kills
        rounds = demo.rounds
        payload = {
            "parser": "awpy",
            "ok": True,
            "versions": {"awpy": _pkg_version("awpy"), "demoparser2": _pkg_version("demoparser2")},
            "summary": {
                "ticks_rows": int(ticks.height) if ticks is not None else 0,
                "kills_rows": int(kills.height) if kills is not None else 0,
                "rounds_rows": int(rounds.height) if rounds is not None else 0,
                "awpy_event_tables": len(demo.events),
            },
        }
        print(json.dumps(payload))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"parser": "awpy", "ok": False, "error": str(e)[:800]}))
        sys.exit(1)


if __name__ == "__main__":
    main()

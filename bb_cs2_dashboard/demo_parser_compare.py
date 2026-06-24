"""
Run awpy, demoparser2, and demoinfocs-golang demo summaries in parallel (subprocesses).

Used by POST /api/demo-parser-compare for operator-side comparison in the admin UI.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

WORKERS_DIR = Path(__file__).resolve().parent / "parser_workers"
DEFAULT_GO_BIN = "/usr/local/bin/demoinfocs-summary"
GO_BIN_ENV = "BB_DEMOINFOCS_SUMMARY_BIN"


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


def _truncate(s: str, max_len: int) -> str:
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "…"


def _compare_timeout_sec() -> float:
    raw = os.environ.get("BB_DEMO_PARSER_COMPARE_TIMEOUT_SEC", "").strip()
    if raw:
        try:
            return max(1.0, min(float(raw), 600.0))
        except ValueError:
            pass
    return 120.0


def _max_stdout_bytes() -> int:
    raw = os.environ.get("BB_DEMO_PARSER_COMPARE_MAX_STDOUT", "").strip()
    if raw:
        try:
            return max(4096, min(int(raw), 8 * 1024 * 1024))
        except ValueError:
            pass
    return 512 * 1024


def _go_binary_path() -> str | None:
    raw = os.environ.get(GO_BIN_ENV, "").strip()
    cand = raw or DEFAULT_GO_BIN
    bp = Path(cand)
    if bp.is_file() and os.access(bp, os.X_OK):
        return str(bp)
    found = shutil.which(cand)
    if found:
        return found
    return None


def _subprocess_env() -> dict[str, str]:
    base = os.environ.copy()
    # Reduce noise from user site-packages in workers.
    base.setdefault("PYTHONNOUSERSITE", "1")
    return base


_WORKER_LABELS = {"awpy": "Awpy", "demoparser2": "LaihoE demoparser2"}


def _run_python_worker(script: str, demo: Path, timeout: float, cap: int) -> dict[str, Any]:
    script_path = WORKERS_DIR / script
    worker_id = script.replace("_summary.py", "")
    label = _WORKER_LABELS.get(worker_id, worker_id)
    if not script_path.is_file():
        return {
            "id": worker_id,
            "label": label,
            "ok": False,
            "skipped": True,
            "exit_code": None,
            "duration_ms": 0.0,
            "summary": None,
            "stdout_json": None,
            "stdout_text": "",
            "stderr_tail": "",
            "error": "worker_script_missing",
        }
    cmd = [sys.executable, str(script_path), str(demo)]
    t0 = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            timeout=timeout,
            text=True,
            env=_subprocess_env(),
        )
    except subprocess.TimeoutExpired:
        dt_ms = (time.perf_counter() - t0) * 1000.0
        return {
            "id": worker_id,
            "label": label,
            "ok": False,
            "skipped": False,
            "exit_code": None,
            "duration_ms": round(dt_ms, 3),
            "summary": None,
            "stdout_json": None,
            "stdout_text": "",
            "stderr_tail": "",
            "error": f"timeout_after_{timeout}s",
        }
    dt_ms = (time.perf_counter() - t0) * 1000.0
    out_raw = proc.stdout or ""
    err_raw = proc.stderr or ""
    out_cap = _truncate(out_raw, cap)
    summary_obj: Any = None
    parse_err: str | None = None
    try:
        summary_obj = json.loads(out_raw.strip())
    except json.JSONDecodeError:
        parse_err = "stdout_not_json"
    ok = proc.returncode == 0 and isinstance(summary_obj, dict) and bool(summary_obj.get("ok"))
    inner = summary_obj.get("summary") if isinstance(summary_obj, dict) else None
    err_from_json = summary_obj.get("error") if isinstance(summary_obj, dict) else None
    merged_err: str | None = None
    if not ok:
        merged_err = err_from_json or parse_err or (f"exit_{proc.returncode}" if proc.returncode is not None else "failed")
    return {
        "id": worker_id,
        "label": label,
        "ok": ok,
        "skipped": False,
        "exit_code": proc.returncode,
        "duration_ms": round(dt_ms, 3),
        "summary": inner,
        "stdout_json": summary_obj if isinstance(summary_obj, dict) else None,
        "stdout_text": out_cap if (parse_err or not summary_obj) else "",
        "stderr_tail": _truncate(err_raw, 6000),
        "error": merged_err,
    }


def _run_go_worker(demo: Path, timeout: float, cap: int) -> dict[str, Any]:
    worker_id = "demoinfocs_golang"
    binary = _go_binary_path()
    if not binary:
        return {
            "id": worker_id,
            "label": "demoinfocs-golang",
            "ok": False,
            "skipped": True,
            "exit_code": None,
            "duration_ms": 0.0,
            "summary": None,
            "stdout_json": None,
            "stdout_text": "",
            "stderr_tail": "",
            "error": "binary_not_installed",
            "hint": f"Install demoinfocs-summary to {DEFAULT_GO_BIN} or set {GO_BIN_ENV}.",
        }
    cmd = [binary, str(demo)]
    t0 = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            timeout=timeout,
            text=True,
            env=_subprocess_env(),
        )
    except subprocess.TimeoutExpired:
        dt_ms = (time.perf_counter() - t0) * 1000.0
        return {
            "id": worker_id,
            "label": "demoinfocs-golang",
            "ok": False,
            "skipped": False,
            "exit_code": None,
            "duration_ms": round(dt_ms, 3),
            "summary": None,
            "stdout_json": None,
            "stdout_text": "",
            "stderr_tail": "",
            "error": f"timeout_after_{timeout}s",
        }
    dt_ms = (time.perf_counter() - t0) * 1000.0
    out_raw = proc.stdout or ""
    err_raw = proc.stderr or ""
    out_cap = _truncate(out_raw, cap)
    summary_obj: Any = None
    parse_err: str | None = None
    try:
        summary_obj = json.loads(out_raw.strip())
    except json.JSONDecodeError:
        parse_err = "stdout_not_json"
    ok = proc.returncode == 0 and parse_err is None and isinstance(summary_obj, dict) and summary_obj.get("ok") is True
    inner = summary_obj.get("summary") if isinstance(summary_obj, dict) else None
    merged_err: str | None = None
    if proc.returncode != 0:
        merged_err = parse_err or _truncate(err_raw, 400) or f"exit_{proc.returncode}"
    elif parse_err:
        merged_err = parse_err
    return {
        "id": worker_id,
        "label": "demoinfocs-golang",
        "ok": ok,
        "skipped": False,
        "exit_code": proc.returncode,
        "duration_ms": round(dt_ms, 3),
        "summary": inner,
        "stdout_json": summary_obj if isinstance(summary_obj, dict) else None,
        "stdout_text": out_cap if (parse_err or not ok) else "",
        "stderr_tail": _truncate(err_raw, 6000),
        "error": merged_err,
    }


def build_parser_compare(path: Path, *, source_filename: str) -> dict[str, Any]:
    """Run all three parser subprocesses and return a JSON-serializable dict."""
    path = path.resolve()
    timeout = _compare_timeout_sec()
    cap = _max_stdout_bytes()
    sha256, nbytes = _hash_file(path)
    meta = {
        "source_filename": source_filename,
        "bytes": nbytes,
        "sha256": sha256,
        "timeout_sec": timeout,
        "max_stdout_bytes": cap,
        "disclaimer": (
            "Compares lightweight summaries only. awpy bundles demoparser2; numbers may be correlated. "
            "demoinfocs-golang v5 targets CS2 and CS:GO demos — very old CS:GO-only builds differ."
        ),
    }
    tasks = {
        "awpy": lambda: _run_python_worker("awpy_summary.py", path, timeout, cap),
        "demoparser2": lambda: _run_python_worker("demoparser2_summary.py", path, timeout, cap),
        "demoinfocs_golang": lambda: _run_go_worker(path, timeout, cap),
    }
    results: dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=3) as pool:
        futs = {pool.submit(fn): key for key, fn in tasks.items()}
        for fut in as_completed(futs):
            key = futs[fut]
            try:
                results[key] = fut.result()
            except Exception as e:  # noqa: BLE001
                results[key] = {
                    "id": key,
                    "label": key,
                    "ok": False,
                    "skipped": False,
                    "exit_code": None,
                    "duration_ms": 0.0,
                    "summary": None,
                    "stdout_json": None,
                    "stdout_text": "",
                    "stderr_tail": _truncate(str(e), 2000),
                    "error": "worker_exception",
                }
    return {"meta": meta, "parsers": results}

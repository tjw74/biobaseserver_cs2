"""Smoke tests for demo parser compare (awpy / demoparser2 / demoinfocs-golang subprocess runners)."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


class DemoParserCompareTests(unittest.TestCase):
    def test_go_skipped_when_binary_missing(self) -> None:
        old = os.environ.get("BB_DEMOINFOCS_SUMMARY_BIN")
        try:
            os.environ["BB_DEMOINFOCS_SUMMARY_BIN"] = "/__no_such_demoinfocs_binary__"
            from demo_parser_compare import build_parser_compare

            with tempfile.TemporaryDirectory() as td:
                p = Path(td) / "small.dem"
                p.write_bytes(b"\0" * 5000)
                out = build_parser_compare(p, source_filename="small.dem")
            self.assertIn("parsers", out)
            go = out["parsers"]["demoinfocs_golang"]
            self.assertFalse(go.get("ok"))
            self.assertTrue(go.get("skipped"))
            self.assertEqual(go.get("error"), "binary_not_installed")
        finally:
            if old is None:
                os.environ.pop("BB_DEMOINFOCS_SUMMARY_BIN", None)
            else:
                os.environ["BB_DEMOINFOCS_SUMMARY_BIN"] = old

    def test_dashboard_route_400_without_source(self) -> None:
        """Hit mounted FastAPI app directly (avoids /admin parent mount in some envs)."""
        from app import dashboard

        client = TestClient(dashboard)
        r = client.post("/api/demo-parser-compare")
        self.assertEqual(r.status_code, 400)
        body = r.json()
        self.assertIn("detail", body)


if __name__ == "__main__":
    unittest.main()

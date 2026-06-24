"""Optional integration test: requires fixtures/sample.dem (see fixtures/README.md)."""

from __future__ import annotations

import unittest
from pathlib import Path

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "sample.dem"


class DemoParsePreviewTests(unittest.TestCase):
    def test_fixture_discovery_non_empty(self) -> None:
        if not FIXTURE.is_file():
            self.skipTest(f"missing fixture: {FIXTURE}")

        from demo_parse_preview import build_discovery_from_path

        got = build_discovery_from_path(FIXTURE, source_filename="sample.dem", event_scan_max=12)
        rows = got.get("discovery_rows") or []
        self.assertGreater(len(rows), 10, "expected discovered rows from real parse")
        meta = got.get("meta") or {}
        self.assertTrue(meta.get("sha256"))
        disc = got.get("discovered") or {}
        self.assertIsInstance(disc.get("ticks_columns"), list)
        samples = disc.get("header_field_samples")
        self.assertIsInstance(samples, dict)
        self.assertGreater(len(samples), 0, "expected header_field_samples from parse")


if __name__ == "__main__":
    unittest.main()

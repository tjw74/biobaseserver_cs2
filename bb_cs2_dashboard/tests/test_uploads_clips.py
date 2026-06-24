"""Unit tests for clip upload listing helpers (no DB; filesystem is source of truth)."""

from __future__ import annotations

import os
import tempfile
import time
import unittest
from pathlib import Path

from fastapi import HTTPException


class ClipUploadHelpersTests(unittest.TestCase):
    def test_clip_display_name_strips_uuid_prefix(self) -> None:
        from app import _clip_display_name

        key32 = "a" * 32
        self.assertEqual(_clip_display_name(f"{key32}_my.demo"), "my.demo")

    def test_clip_display_name_unknown_passthrough(self) -> None:
        from app import _clip_display_name

        self.assertEqual(_clip_display_name("manual_drop.bin"), "manual_drop.bin")

    def test_resolve_stored_clip_file_ok(self) -> None:
        from app import _resolve_stored_clip_file

        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        (tmp / "abc.bin").write_bytes(b"!")
        p = _resolve_stored_clip_file("abc.bin", root=tmp)
        self.assertEqual(p.name, "abc.bin")

    def test_resolve_stored_clip_rejects_subpath_style_name(self) -> None:
        from app import _resolve_stored_clip_file

        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        (tmp / "only.txt").write_bytes(b"x")
        with self.assertRaises(HTTPException) as ctx:
            _resolve_stored_clip_file("nested/only.txt", root=tmp)
        self.assertEqual(ctx.exception.status_code, 400)

    def test_list_clip_uploads_sorts_newest_first(self) -> None:
        from app import _list_clip_uploads

        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        old = tmp / "b_old.txt"
        new = tmp / "a_new.txt"
        old.write_text("o")
        new.write_text("n")

        ts = time.time() - 3600
        os.utime(old, (ts, ts))

        rows = _list_clip_uploads(root=tmp)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["name"], "a_new.txt")

    def test_list_clip_libraries_counts_mp4_subdirs(self) -> None:
        from app import _list_clip_libraries

        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        lib = tmp / "klingis_tv_tiktok"
        lib.mkdir()
        (lib / "one.mp4").write_bytes(b"x")
        (lib / "skip.txt").write_text("n")
        rows = _list_clip_libraries(root=tmp)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "klingis_tv_tiktok")
        self.assertEqual(rows[0]["mp4_count"], 1)

    def test_list_clip_library_items_filters_and_pages(self) -> None:
        from app import _list_clip_library_items

        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        lib = tmp / "klingis_tv_tiktok"
        lib.mkdir()
        (lib / "alpha.mp4").write_bytes(b"a")
        (lib / "beta.mp4").write_bytes(b"b")
        payload = _list_clip_library_items("klingis_tv_tiktok", limit=1, offset=0, root=tmp)
        self.assertEqual(payload["total"], 2)
        self.assertEqual(len(payload["items"]), 1)
        self.assertTrue(payload["has_more"])
        filtered = _list_clip_library_items("klingis_tv_tiktok", q="alpha", root=tmp)
        self.assertEqual(filtered["total"], 1)
        self.assertEqual(filtered["items"][0]["name"], "alpha.mp4")

    def test_resolve_clip_in_library_ok(self) -> None:
        from app import _resolve_clip_in_library

        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        lib = tmp / "klingis_tv_tiktok"
        lib.mkdir()
        (lib / "clip.mp4").write_bytes(b"v")
        p = _resolve_clip_in_library("klingis_tv_tiktok", "clip.mp4", root=tmp)
        self.assertEqual(p.name, "clip.mp4")

    def test_api_upload_accepts_multipart_file_part(self) -> None:
        import app as app_mod
        from fastapi.testclient import TestClient
        from unittest.mock import patch

        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, ignore_errors=True))
        with patch.object(app_mod, "DASHBOARD_TOKEN", ""), patch.object(
            app_mod,
            "CLIPS_UPLOAD_DIR",
            tmp,
        ):
            client = TestClient(app_mod.dashboard)
            r = client.post(
                "/api/uploads",
                files={"file": ("probe.txt", b"hello", "text/plain")},
            )

        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body.get("ok"))
        self.assertEqual(body.get("bytes"), 5)
        saved_as = body.get("saved_as")
        self.assertIsInstance(saved_as, str)
        self.assertTrue((tmp / saved_as).is_file())

if __name__ == "__main__":
    unittest.main()

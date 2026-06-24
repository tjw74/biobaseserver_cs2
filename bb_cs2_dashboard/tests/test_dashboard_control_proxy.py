"""Fast tests: control token env resolution, /api/map proxy headers+JSON, dashboard user allowlist."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


class ResolveControlTokenTests(unittest.TestCase):
    def test_cs2_control_token_preferred_over_bb(self) -> None:
        from app import _resolve_control_token

        env = {
            "CS2_CONTROL_TOKEN": "from_cs2",
            "BB_CS2_CONTROL_TOKEN": "from_bb",
        }
        with patch.dict(os.environ, env, clear=False):
            self.assertEqual(_resolve_control_token(), "from_cs2")

    def test_falls_back_to_bb_cs2_control_token(self) -> None:
        from app import _resolve_control_token

        with patch.dict(os.environ, {"CS2_CONTROL_TOKEN": "", "BB_CS2_CONTROL_TOKEN": "only_bb"}, clear=False):
            self.assertEqual(_resolve_control_token(), "only_bb")

    def test_strips_whitespace(self) -> None:
        from app import _resolve_control_token

        with patch.dict(
            os.environ,
            {"CS2_CONTROL_TOKEN": "  trimmed  ", "BB_CS2_CONTROL_TOKEN": "ignored"},
            clear=False,
        ):
            self.assertEqual(_resolve_control_token(), "trimmed")


class ParseDashboardUsersTests(unittest.TestCase):
    def test_comma_separated_allowlist_trims_and_skips_empty(self) -> None:
        from app import _parse_allowed_dashboard_usernames

        with patch.dict(os.environ, {"BB_CS2_DASHBOARD_USER": " alice , , bob "}, clear=False):
            self.assertEqual(_parse_allowed_dashboard_usernames(), ("alice", "bob"))

    def test_empty_env_returns_empty_tuple(self) -> None:
        from app import _parse_allowed_dashboard_usernames

        with patch.dict(os.environ, {"BB_CS2_DASHBOARD_USER": ""}, clear=False):
            self.assertEqual(_parse_allowed_dashboard_usernames(), ())


class ApiMapProxyTests(unittest.TestCase):
    def test_post_api_map_forwards_x_api_key_and_json(self) -> None:
        import app as app_mod

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"ok": True, "map": "de_dust2"}

        with patch.object(app_mod, "DASHBOARD_TOKEN", ""), patch.object(
            app_mod,
            "CONTROL_TOKEN",
            "ctrl-secret",
        ), patch.object(app_mod, "CONTROL_URL", "http://control.test"), patch(
            "app.httpx.post",
            return_value=mock_resp,
        ) as m_post:
            client = TestClient(app_mod.app)
            r = client.post("/api/map", json={"map": "de_dust2"})

        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"ok": True, "map": "de_dust2"})
        m_post.assert_called_once()
        url = m_post.call_args[0][0]
        self.assertEqual(url, "http://control.test/api/map")
        kwargs = m_post.call_args[1]
        self.assertEqual(kwargs.get("json"), {"map": "de_dust2"})
        hdr = kwargs.get("headers") or {}
        self.assertEqual(hdr.get("X-Api-Key"), "ctrl-secret")
        self.assertEqual(hdr.get("Content-Type"), "application/json")


class AuthLoginAllowlistTests(unittest.TestCase):
    def test_login_rejects_wrong_username_when_allowlist_set(self) -> None:
        import app as app_mod

        with patch.object(app_mod, "DASHBOARD_TOKEN", "pwd"), patch.object(
            app_mod,
            "DASHBOARD_ALLOWED_USERNAMES",
            ("alice",),
        ):
            client = TestClient(app_mod.app)
            r = client.post("/api/auth/login", json={"username": "bob", "password": "pwd"})
        self.assertEqual(r.status_code, 401)

    def test_login_accepts_allowlisted_username_and_password(self) -> None:
        import app as app_mod

        with patch.object(app_mod, "DASHBOARD_TOKEN", "pwd"), patch.object(
            app_mod,
            "DASHBOARD_ALLOWED_USERNAMES",
            ("alice",),
        ):
            client = TestClient(app_mod.app)
            r = client.post("/api/auth/login", json={"username": "alice", "password": "pwd"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"ok": True})
        self.assertIn(app_mod.AUTH_COOKIE, r.cookies)


if __name__ == "__main__":
    unittest.main()

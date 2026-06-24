"""Tests for scoped desktop client remote command delivery."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import client_api


class ClientCommandScopeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.tmp.name)
        self.devices_path = self.data_dir / "devices.json"
        self.commands_path = self.data_dir / "device_commands.json"
        self.device_id = "dev_testscope001"
        self.device_token = "token-test-scope"
        self.devices_path.write_text(
            json.dumps(
                {
                    "devices": {
                        self.device_id: {
                            "token": self.device_token,
                            "deviceName": "Test PC",
                            "appVersion": "0.1.0",
                            "pairedAt": "2026-01-01T00:00:00Z",
                        }
                    }
                }
            ),
            encoding="utf-8",
        )
        self.env = patch.dict(
            os.environ,
            {
                "BB_CLIENT_DATA_DIR": str(self.data_dir),
                "BB_CLIENT_PAIRING_CODE": "TESTPAIR",
                "BB_CLIENT_REMOTE_SECRET": "secret",
            },
            clear=False,
        )
        self.env.start()
        self.path_devices = patch.object(client_api, "_devices_path", return_value=self.devices_path)
        self.path_commands = patch.object(client_api, "_commands_path", return_value=self.commands_path)
        self.remote_secret = patch.object(client_api, "CLIENT_REMOTE_SECRET", "secret")
        self.path_devices.start()
        self.path_commands.start()
        self.remote_secret.start()
        app = FastAPI()
        client_api.register_client_routes(app, "http://control", lambda: {})
        self.client = TestClient(app)
        self.headers = {
            "X-Biobase-Device-Id": self.device_id,
            "X-Biobase-Device-Token": self.device_token,
            "X-Biobase-App-Version": "0.1.26",
            "X-Biobase-Hostname": "test-host",
        }

    def tearDown(self) -> None:
        self.remote_secret.stop()
        self.path_commands.stop()
        self.path_devices.stop()
        self.env.stop()
        self.tmp.cleanup()

    def _queue(self, command: str) -> None:
        response = self.client.post(
            "/api/client/device/commands",
            json={"deviceId": self.device_id, "command": command},
            headers={"X-Biobase-Remote-Secret": "secret"},
        )
        self.assertEqual(response.status_code, 200, response.text)

    def test_watchdog_receives_kill_app_after_main_consumed_close_overlay(self) -> None:
        self._queue("close_overlay")
        self._queue("kill_app")

        main = self.client.get("/api/client/device/commands?scope=main", headers=self.headers)
        self.assertEqual(main.status_code, 200)
        main_commands = [entry["command"] for entry in main.json()["commands"]]
        self.assertEqual(main_commands, ["close_overlay"])

        watchdog = self.client.get("/api/client/device/commands?scope=watchdog", headers=self.headers)
        self.assertEqual(watchdog.status_code, 200)
        watchdog_commands = [entry["command"] for entry in watchdog.json()["commands"]]
        self.assertEqual(watchdog_commands, ["kill_app", "close_overlay"])

        devices = json.loads(self.devices_path.read_text(encoding="utf-8"))
        entry = devices["devices"][self.device_id]
        self.assertEqual(entry["appVersion"], "0.1.26")
        self.assertEqual(entry["hostname"], "test-host")
        self.assertIn("lastSeen", entry)

    def test_main_scope_excludes_kill_app(self) -> None:
        self._queue("kill_app")
        main = self.client.get("/api/client/device/commands?scope=main", headers=self.headers)
        self.assertEqual(main.status_code, 200)
        self.assertEqual(main.json()["commands"], [])

        watchdog = self.client.get("/api/client/device/commands?scope=watchdog", headers=self.headers)
        self.assertEqual(watchdog.status_code, 200)
        self.assertEqual([entry["command"] for entry in watchdog.json()["commands"]], ["kill_app"])

    def test_presence_records_share_stats(self) -> None:
        response = self.client.post(
            "/api/client/live/presence",
            json={
                "sessionId": "sess_test123",
                "deviceName": "Coach Mac",
                "playerName": "Paul",
                "shareStats": True,
                "appVersion": "0.1.39",
                "hostname": "macbook",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["recorded"])

    def test_device_poll_stores_share_stats_headers(self) -> None:
        headers = {
            **self.headers,
            "X-Biobase-Share-Stats": "0",
            "X-Biobase-Tracked-Player": "Paul",
        }
        response = self.client.get("/api/client/device/commands?scope=main", headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        devices = json.loads(self.devices_path.read_text(encoding="utf-8"))
        entry = devices["devices"][self.device_id]
        self.assertFalse(entry["shareStatsOnServer"])
        self.assertEqual(entry["trackedPlayerName"], "Paul")

    def test_companion_link_create_and_resolve(self) -> None:
        create = self.client.post(
            "/api/client/companion/link",
            json={"playerName": "Paul", "steamid": "76561198000000000", "deviceName": "Test PC"},
        )
        self.assertEqual(create.status_code, 200, create.text)
        payload = create.json()
        self.assertTrue(payload["ok"])
        code = payload["code"]
        resolve = self.client.get(f"/api/client/companion/resolve/{code}")
        self.assertEqual(resolve.status_code, 200, resolve.text)
        self.assertEqual(resolve.json()["playerName"], "Paul")


if __name__ == "__main__":
    unittest.main()

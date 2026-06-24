from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import client_api


class ClientSessionApiTests(unittest.TestCase):
    def test_paired_device_can_store_and_read_its_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            device_id = "dev_sessiontest01"
            token = "session-token"
            devices_path = data_dir / "devices.json"
            devices_path.write_text(
                json.dumps(
                    {
                        "devices": {
                            device_id: {
                                "token": token,
                                "deviceName": "Release PC",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            with (
                patch.object(client_api, "CLIENT_DATA_DIR", data_dir),
                patch.object(
                    client_api,
                    "_devices_path",
                    return_value=devices_path,
                ),
            ):
                app = FastAPI()
                client_api.register_client_routes(
                    app,
                    "http://control",
                    lambda: {},
                )
                client = TestClient(app)
                headers = {
                    "X-Biobase-Device-Id": device_id,
                    "X-Biobase-Device-Token": token,
                }
                upload = client.post(
                    "/api/client/sessions",
                    headers=headers,
                    json={
                        "schemaVersion": "biobase-performance-v1",
                        "categories": [{"id": "movement", "score": 72}],
                    },
                )
                self.assertEqual(upload.status_code, 200, upload.text)
                self.assertTrue(upload.json()["stored"])

                listed = client.get(
                    "/api/client/sessions",
                    headers=headers,
                )
                self.assertEqual(listed.status_code, 200, listed.text)
                rows = listed.json()["sessions"]
                self.assertEqual(len(rows), 1)
                self.assertEqual(
                    rows[0]["schemaVersion"],
                    "biobase-performance-v1",
                )

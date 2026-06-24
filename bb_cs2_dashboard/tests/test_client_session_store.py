from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from client_session_store import ClientSessionStore


class ClientSessionStoreTests(unittest.TestCase):
    def test_insert_and_list_are_device_scoped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ClientSessionStore(Path(tmp))
            first = store.insert(
                device_id="dev_one",
                device_name="Primary PC",
                payload={"schemaVersion": "biobase-performance-v1", "score": 72},
            )
            store.insert(
                device_id="dev_two",
                device_name="Other PC",
                payload={"schemaVersion": "biobase-performance-v1", "score": 41},
            )

            rows = store.list_for_device("dev_one")
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["id"], first["id"])
            self.assertEqual(rows[0]["payload"]["score"], 72)
            self.assertEqual(
                rows[0]["schemaVersion"],
                "biobase-performance-v1",
            )

    def test_list_limit_is_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ClientSessionStore(Path(tmp))
            for index in range(4):
                store.insert(
                    device_id="dev_one",
                    device_name="Primary PC",
                    payload={"version": 1, "index": index},
                )
            rows = store.list_for_device("dev_one", limit=2)
            self.assertEqual(len(rows), 2)

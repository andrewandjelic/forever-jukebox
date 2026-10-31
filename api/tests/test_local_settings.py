from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from dotenv import dotenv_values
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import local_settings
from api.routes.config import get_app_config

LOCAL = ("127.0.0.1", 50000)


class SpotifySettingsTest(unittest.TestCase):
    def setUp(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        self.env_file = Path(temp_dir.name) / ".env"
        self.env_file.write_text("ALLOW_USER_UPLOAD=true\n", encoding="utf-8")
        for patcher in (
            patch.object(local_settings, "ENV_FILE", self.env_file),
            patch.dict(os.environ, {"ALLOW_LOCAL_SETTINGS": "true"}, clear=True),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        app = FastAPI()
        app.include_router(local_settings.router)
        self.local = TestClient(app, client=LOCAL)
        self.remote = TestClient(app, client=("203.0.113.7", 50000))

    def _connect(self, client: TestClient, **check):
        with patch.object(local_settings.spotify, "check_credentials", **check) as checked:
            response = client.post(
                "/api/settings/spotify",
                json={"client_id": " my-id ", "client_secret": "my-secret"},
            )
        return response, checked

    def test_connect_saves_checked_keys_to_env_and_config(self) -> None:
        response, checked = self._connect(self.local)

        self.assertEqual(response.status_code, 200)
        checked.assert_called_once_with("my-id", "my-secret")
        saved = dotenv_values(self.env_file)
        self.assertEqual(saved["SPOTIFY_CLIENT_ID"], "my-id")
        self.assertEqual(saved["SPOTIFY_CLIENT_SECRET"], "my-secret")
        self.assertEqual(saved["ALLOW_USER_UPLOAD"], "true")
        self.assertTrue(json.loads(get_app_config().body)["spotify_configured"])

    def test_rejected_keys_are_not_saved(self) -> None:
        request = httpx.Request("POST", "https://accounts.spotify.com/api/token")
        refused = httpx.HTTPStatusError(
            "bad", request=request, response=httpx.Response(400, request=request)
        )
        response, _ = self._connect(self.local, side_effect=refused)

        self.assertEqual(response.status_code, 400)
        self.assertIn("did not accept", response.json()["detail"])
        self.assertNotIn("SPOTIFY_CLIENT_ID", dotenv_values(self.env_file))
        self.assertFalse(json.loads(get_app_config().body)["spotify_configured"])

    def test_disconnect_removes_the_keys(self) -> None:
        self._connect(self.local)

        response = self.local.delete("/api/settings/spotify")

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("SPOTIFY_CLIENT_SECRET", dotenv_values(self.env_file))
        self.assertNotIn("SPOTIFY_CLIENT_SECRET", os.environ)

    def test_only_local_requests_with_the_flag(self) -> None:
        remote, _ = self._connect(self.remote)
        with patch.dict(os.environ, {"ALLOW_LOCAL_SETTINGS": ""}):
            flag_off, _ = self._connect(self.local)

        self.assertEqual(remote.status_code, 403)
        self.assertEqual(flag_off.status_code, 403)
        self.assertNotIn("SPOTIFY_CLIENT_ID", dotenv_values(self.env_file))


if __name__ == "__main__":
    unittest.main()

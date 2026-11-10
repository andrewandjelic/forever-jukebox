from __future__ import annotations

import base64
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.db import _connect, create_job, get_job, init_db
from api.routes import client_analysis
from api.routes.jobs_runtime import normalize_job_error
from api.utils import read_analysis_json, resolve_analysis_path

ANALYSIS = {
    "track": {"duration": 2.0, "tempo": 120},
    "sections": [{"start": 0, "duration": 2, "confidence": 1}],
    "bars": [{"start": 0, "duration": 2, "confidence": 1}],
    "beats": [{"start": 0, "duration": 0.5, "confidence": 1}],
    "tatums": [{"start": 0, "duration": 0.25, "confidence": 1}],
    "segments": [],
}


class ClientAnalysisTest(unittest.TestCase):
    def setUp(self) -> None:
        temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(temp_dir.cleanup)
        self.storage = Path(temp_dir.name)
        self.db_path = self.storage / "jobs.db"
        init_db(self.db_path)
        for name, value in (("DB_PATH", self.db_path), ("STORAGE_ROOT", self.storage)):
            patcher = patch.object(client_analysis, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        env_patch = patch.dict(os.environ, {"ALLOW_CLIENT_ANALYSIS": "true"})
        env_patch.start()
        self.addCleanup(env_patch.stop)
        app = FastAPI()
        app.include_router(client_analysis.router)
        self.client = TestClient(app)

    def _queue_job(self, job_id: str, *, with_audio: bool = True) -> None:
        create_job(self.db_path, job_id, status="queued", source_provider="upload")
        if with_audio:
            audio_dir = self.storage / "audio"
            audio_dir.mkdir(exist_ok=True)
            (audio_dir / f"{job_id}.mp3").write_bytes(b"audio")

    def _claim(self, job_id: str) -> bool:
        response = self.client.post(f"/api/analysis/{job_id}/client/claim")
        self.assertEqual(response.status_code, 200)
        return response.json()["claimed"]

    def test_claim_result_completes_the_job(self) -> None:
        self._queue_job("job-1")

        self.assertTrue(self._claim("job-1"))
        self.assertEqual(get_job(self.db_path, "job-1").status, "processing")
        response = self.client.post(
            "/api/analysis/job-1/client/result", content=json.dumps(ANALYSIS)
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(get_job(self.db_path, "job-1").status, "complete")
        stored = resolve_analysis_path(self.storage, "job-1")
        self.assertEqual(stored.name, "job-1.json.gz")
        self.assertEqual(read_analysis_json(stored), ANALYSIS)

    def test_a_job_is_claimed_once(self) -> None:
        self._queue_job("job-1")

        self.assertTrue(self._claim("job-1"))
        self.assertFalse(self._claim("job-1"))

    def test_a_quiet_claim_can_be_taken_over(self) -> None:
        self._queue_job("job-1")
        self.assertTrue(self._claim("job-1"))
        long_ago = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        with _connect(self.db_path) as conn:
            conn.execute("UPDATE jobs SET updated_at = ? WHERE id = ?", (long_ago, "job-1"))
            conn.commit()

        self.assertTrue(self._claim("job-1"))

    def test_nothing_to_claim_before_the_audio_arrives(self) -> None:
        self._queue_job("job-1", with_audio=False)

        self.assertFalse(self._claim("job-1"))
        self.assertEqual(get_job(self.db_path, "job-1").status, "queued")

    def test_result_requires_a_claim_and_a_real_analysis(self) -> None:
        self._queue_job("job-1")
        unclaimed = self.client.post(
            "/api/analysis/job-1/client/result", content=json.dumps(ANALYSIS)
        )
        self._claim("job-1")
        malformed = self.client.post(
            "/api/analysis/job-1/client/result", content=json.dumps({"track": {}})
        )

        self.assertEqual(unclaimed.status_code, 409)
        self.assertEqual(malformed.status_code, 422)
        self.assertEqual(get_job(self.db_path, "job-1").status, "processing")

    def test_failure_is_recorded(self) -> None:
        self._queue_job("job-1")
        self._claim("job-1")

        response = self.client.post(
            "/api/analysis/job-1/client/fail", json={"error": "out of memory"}
        )

        self.assertEqual(response.status_code, 200)
        job = get_job(self.db_path, "job-1")
        self.assertEqual(job.status, "failed")
        self.assertIn("out of memory", job.error)

    def test_failure_reason_reaches_the_listener(self) -> None:
        # Collapsed to the generic error, the web app would show a YouTube
        # track's failed analysis as "YouTube fetch failed".
        self._queue_job("job-1")
        self._claim("job-1")
        self.client.post(
            "/api/analysis/job-1/client/fail",
            json={"error": "Array buffer\n allocation failed"},
        )

        self.assertEqual(
            normalize_job_error(get_job(self.db_path, "job-1").error),
            "ERROR: Browser analysis failed: Array buffer allocation failed",
        )

    def test_failure_context_goes_to_the_job_log(self) -> None:
        self._queue_job("job-1")
        self._claim("job-1")

        self.client.post(
            "/api/analysis/job-1/client/fail",
            json={
                "error": "RangeError: Array buffer allocation failed",
                "stage": "decoding",
                "percent": 2,
                "duration_s": 4051.2,
                "browser": "Mozilla/5.0 Chrome/142",
                "cpu_threads": 8,
                "device_memory_gb": 8,
                "stack": "RangeError: Array buffer allocation failed\n    at decode",
            },
        )

        log = (self.storage / "logs" / "job-1.log").read_text(encoding="utf-8")
        self.assertIn("failed during browser analysis", log)
        for expected in (
            "Error:        RangeError: Array buffer allocation failed",
            "Step:         decoding",
            "Reached:      2%",
            "Track length: 67:31",
            "CPU threads:  8",
            "Memory:       about 8 GB",
            "    at decode",
        ):
            self.assertIn(expected, log)
        self.assertIn("job-1", (self.storage / "logs" / "errors.log").read_text(encoding="utf-8"))

    def _complete_job(self, job_id: str) -> None:
        self._queue_job(job_id)
        self._claim(job_id)
        self.client.post(f"/api/analysis/{job_id}/client/result", content=json.dumps(ANALYSIS))

    def test_a_vocal_map_is_added_to_a_finished_analysis(self) -> None:
        self._complete_job("job-1")
        vocals = {
            "version": 1,
            "state": "4",
            "sung": "1",
            "print": base64.b64encode(bytes(72)).decode("ascii"),
        }

        response = self.client.put("/api/analysis/job-1/vocals", content=json.dumps(vocals))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"stored": True})
        stored = read_analysis_json(resolve_analysis_path(self.storage, "job-1"))
        self.assertEqual(stored, {**ANALYSIS, "vocals": vocals})

    def test_the_first_vocal_map_is_kept(self) -> None:
        self._complete_job("job-1")
        first = {"version": 1, "state": "0", "sung": "0", "print": base64.b64encode(bytes(72)).decode("ascii")}
        second = {**first, "state": "4", "sung": "1"}
        self.client.put("/api/analysis/job-1/vocals", content=json.dumps(first))

        response = self.client.put("/api/analysis/job-1/vocals", content=json.dumps(second))

        self.assertEqual(response.json(), {"stored": False})
        stored = read_analysis_json(resolve_analysis_path(self.storage, "job-1"))
        self.assertEqual(stored["vocals"], first)

    def test_a_vocal_map_must_fit_the_track(self) -> None:
        self._complete_job("job-1")
        good = {"version": 1, "state": "0", "sung": "0", "print": base64.b64encode(bytes(72)).decode("ascii")}
        wrong = [
            {**good, "version": 2},
            {**good, "state": "00"},  # two beats' worth for a one-beat track
            {**good, "state": "7"},
            {**good, "sung": "2"},
            {**good, "print": "not base64!"},
            {**good, "print": base64.b64encode(bytes(3)).decode("ascii")},  # not two halves
            {"version": 1},
            [],
        ]

        for vocals in wrong:
            response = self.client.put("/api/analysis/job-1/vocals", content=json.dumps(vocals))
            self.assertEqual(response.status_code, 422, vocals)
        self.assertEqual(
            self.client.put("/api/analysis/job-1/vocals", content="{not json").status_code, 422
        )
        self.assertNotIn("vocals", read_analysis_json(resolve_analysis_path(self.storage, "job-1")))

    def test_a_vocal_map_waits_for_the_analysis(self) -> None:
        self._queue_job("job-1")
        vocals = {"version": 1, "state": "0", "sung": "0", "print": base64.b64encode(bytes(72)).decode("ascii")}

        response = self.client.put("/api/analysis/job-1/vocals", content=json.dumps(vocals))

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            self.client.put("/api/analysis/nope/vocals", content=json.dumps(vocals)).status_code, 404
        )

    def test_disabled_without_the_flag(self) -> None:
        self._queue_job("job-1")
        with patch.dict(os.environ, {"ALLOW_CLIENT_ANALYSIS": ""}):
            response = self.client.post("/api/analysis/job-1/client/claim")
            vocals = self.client.put("/api/analysis/job-1/vocals", content="{}")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(vocals.status_code, 403)


if __name__ == "__main__":
    unittest.main()

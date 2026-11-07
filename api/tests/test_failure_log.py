from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from api import failure_log
from api.failure_log import ERRORS_LOG_NAME, format_failure, record_failure

JOB = SimpleNamespace(
    track_title="TRAPPIN IN JAPAN 23 [Director's Cut]",
    track_artist="Ryan Celsius Sounds",
    source_provider="youtube",
    source_id="8JmJdUjCDBM",
    source_url="https://www.youtube.com/watch?v=8JmJdUjCDBM",
)


class FailureLogTest(unittest.TestCase):
    def setUp(self) -> None:
        temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(temp_dir.cleanup)
        self.storage = Path(temp_dir.name)

    def test_entry_names_the_track_source_and_error(self) -> None:
        entry = format_failure(
            JOB,
            "job-1",
            "browser analysis",
            "RangeError: Array buffer allocation failed",
            {"Reached": "40%", "Browser": None, "Stack": "at decode\nat analyze"},
            now=datetime(2026, 11, 6, 20, 41, 12, tzinfo=timezone.utc),
        )

        lines = entry.splitlines()
        self.assertIn("Job job-1 failed during browser analysis", lines[0])
        self.assertIn("  Track:   TRAPPIN IN JAPAN 23 [Director's Cut] - Ryan Celsius Sounds", lines)
        self.assertIn("  Source:  YouTube 8JmJdUjCDBM", lines)
        self.assertIn("  Error:   RangeError: Array buffer allocation failed", lines)
        self.assertIn("  Reached: 40%", lines)
        # Empty details are left out; multi-line ones go indented under the label.
        self.assertNotIn("Browser", entry)
        self.assertEqual(lines[-3:], ["  Stack:", "    at decode", "    at analyze"])

    def test_writes_the_job_log_and_appends_to_errors_log(self) -> None:
        record_failure(self.storage, JOB, "job-1", "download", "HTTP Error 403: Forbidden")
        record_failure(self.storage, None, "job-2", "download", "Unable to download video data")

        logs = self.storage / "logs"
        self.assertIn("HTTP Error 403", (logs / "job-1.log").read_text(encoding="utf-8"))
        self.assertNotIn("job-1", (logs / "job-2.log").read_text(encoding="utf-8"))
        errors = (logs / ERRORS_LOG_NAME).read_text(encoding="utf-8")
        self.assertLess(errors.index("Job job-1 failed"), errors.index("Job job-2 failed"))

    def test_errors_log_rolls_over_past_its_cap(self) -> None:
        with patch.object(failure_log, "ERRORS_LOG_MAX_BYTES", 10):
            record_failure(self.storage, JOB, "old-job", "download", "first")
            record_failure(self.storage, JOB, "new-job", "download", "second")

        logs = self.storage / "logs"
        self.assertIn("old-job", (logs / f"{ERRORS_LOG_NAME}.1").read_text(encoding="utf-8"))
        current = (logs / ERRORS_LOG_NAME).read_text(encoding="utf-8")
        self.assertIn("new-job", current)
        self.assertNotIn("old-job", current)

    def test_an_unwritable_log_does_not_raise(self) -> None:
        (self.storage / "logs").write_text("not a directory", encoding="utf-8")

        record_failure(self.storage, JOB, "job-1", "download", "boom")


if __name__ == "__main__":
    unittest.main()

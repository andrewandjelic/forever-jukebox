"""Failure logs: what went wrong with a job, in words someone can paste.

Every failure writes logs/<job id>.log, which /api/logs/<job id> serves and
the web app shows under Details, and appends the same entry to
logs/errors.log, the jukebox-wide record. A one-line summary also goes to
the server console.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path

from .utils import get_logger

logger = get_logger()

ERRORS_LOG_NAME = "errors.log"
# Past this size errors.log moves to errors.log.1 (replacing the older one),
# so the record never grows without bound.
ERRORS_LOG_MAX_BYTES = 1024 * 1024

_SOURCE_LABELS = {
    "youtube": "YouTube",
    "soundcloud": "SoundCloud",
    "bandcamp": "Bandcamp",
    "upload": "Upload",
}


def _indent(text: str) -> str:
    return "\n".join(f"    {line}" for line in text.rstrip().splitlines())


def format_failure(
    job,
    job_id: str,
    stage: str,
    message: str,
    details: Mapping[str, object] | None = None,
    now: datetime | None = None,
) -> str:
    """The log entry: a heading line, then labelled lines. Multi-line values
    (a stack, engine output) go indented under their label."""
    stamp = (now or datetime.now(timezone.utc)).astimezone().strftime("%Y-%m-%d %H:%M:%S %z")
    lines = [f"{stamp}  Job {job_id} failed during {stage}"]
    fields: list[tuple[str, object]] = []
    if job is not None:
        title = (getattr(job, "track_title", None) or "").strip()
        artist = (getattr(job, "track_artist", None) or "").strip()
        if title:
            fields.append(("Track", f"{title} - {artist}" if artist else title))
        provider = getattr(job, "source_provider", None) or ""
        source = _SOURCE_LABELS.get(provider, provider)
        source_ref = getattr(job, "source_id", None) or getattr(job, "source_url", None)
        if source or source_ref:
            fields.append(("Source", " ".join(part for part in (source, source_ref) if part)))
    fields.append(("Error", message.strip() or "unknown error"))
    fields.extend((details or {}).items())
    width = max(len(label) for label, _ in fields) + 2
    for label, value in fields:
        if value is None or value == "":
            continue
        text = str(value)
        if "\n" in text.strip():
            lines.append(f"  {label}:")
            lines.append(_indent(text))
        else:
            lines.append(f"  {f'{label}:':<{width}}{text.strip()}")
    return "\n".join(lines) + "\n"


def _append_to_errors_log(log_dir: Path, entry: str) -> None:
    path = log_dir / ERRORS_LOG_NAME
    try:
        if path.stat().st_size > ERRORS_LOG_MAX_BYTES:
            os.replace(path, path.with_name(f"{ERRORS_LOG_NAME}.1"))
    except FileNotFoundError:
        pass
    with path.open("a", encoding="utf-8") as handle:
        handle.write(entry + "\n")


def record_failure(
    storage_root: Path,
    job,
    job_id: str,
    stage: str,
    message: str,
    details: Mapping[str, object] | None = None,
) -> None:
    """Write the job's log and the errors.log entry. Never raises: a full disk
    must not stop the job itself being marked failed."""
    entry = format_failure(job, job_id, stage, message, details)
    log_dir = storage_root / "logs"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        (log_dir / f"{job_id}.log").write_text(entry, encoding="utf-8")
        _append_to_errors_log(log_dir, entry)
    except OSError as exc:
        logger.warning("Could not write the failure log for job %s: %s", job_id, exc)
    summary = " ".join(message.split())[:200] or "unknown error"
    logger.warning("Job %s failed during %s: %s", job_id, stage, summary)

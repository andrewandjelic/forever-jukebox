"""Manual storage cleanup for cold completed jobs.

Only artifacts are removed; the job and source rows stay, so shared links,
favorites and play history survive and the track is re-fetched on next request.
Tracks that were never opened are eligible after a short grace period; everything
else waits out the full dormancy window. Uploaded tracks are exempt: they have no
source to re-fetch from.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .db import _connect
from .models import StorageCleanupCandidateItem, StorageCleanupError, StorageCleanupResponse
from .routes.jobs_runtime import delete_job_artifacts


CLEANUP_POLICY_DAYS = 365
ZERO_PLAY_GRACE_DAYS = 7

# Shared by the scan and the pre-delete re-check so the two cannot diverge.
_ELIGIBILITY_SQL = """
              j.status = 'complete'
              AND s.provider != 'upload'
              AND (
                julianday(s.updated_at) < julianday('now', ?)
                OR (
                  s.play_count = 0
                  AND julianday(s.updated_at) < julianday('now', ?)
                )
              )
"""


@dataclass(frozen=True)
class CleanupCandidate:
    job_id: str
    provider: str
    source_id: str | None
    source_url: str | None
    title: str | None
    artist: str | None
    play_count: int
    updated_at: str


def _cutoff_arg(days: int) -> str:
    return f"-{max(1, int(days))} days"


def _eligibility_params(days: int) -> tuple[str, str]:
    return (_cutoff_arg(days), _cutoff_arg(ZERO_PLAY_GRACE_DAYS))


def _candidate_from_row(row: tuple) -> CleanupCandidate:
    return CleanupCandidate(
        job_id=str(row[0]),
        provider=str(row[1] or ""),
        source_id=str(row[2]) if row[2] is not None else None,
        source_url=str(row[3]) if row[3] is not None else None,
        title=str(row[4]) if row[4] is not None else None,
        artist=str(row[5]) if row[5] is not None else None,
        play_count=int(row[6] or 0),
        updated_at=str(row[7] or ""),
    )


def find_cleanup_candidates(db_path: Path, days: int = CLEANUP_POLICY_DAYS) -> list[CleanupCandidate]:
    with _connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT
              j.id,
              s.provider,
              s.source_id,
              s.source_url,
              s.track_title,
              s.track_artist,
              s.play_count,
              s.updated_at
            FROM jobs j
            JOIN sources s ON s.id = j.source_ref
            WHERE """
            + _ELIGIBILITY_SQL
            + """
            ORDER BY s.updated_at ASC, j.id ASC
            """,
            _eligibility_params(days),
        ).fetchall()
    return [_candidate_from_row(row) for row in rows]


def find_cleanup_candidate_by_id(
    db_path: Path,
    job_id: str,
    days: int = CLEANUP_POLICY_DAYS,
) -> CleanupCandidate | None:
    with _connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT
              j.id,
              s.provider,
              s.source_id,
              s.source_url,
              s.track_title,
              s.track_artist,
              s.play_count,
              s.updated_at
            FROM jobs j
            JOIN sources s ON s.id = j.source_ref
            WHERE j.id = ?
              AND """
            + _ELIGIBILITY_SQL,
            (job_id, *_eligibility_params(days)),
        ).fetchone()
    return _candidate_from_row(row) if row else None


def artifact_paths(storage_root: Path, candidate: CleanupCandidate) -> list[Path]:
    paths: list[Path] = []
    paths.append(storage_root / "logs" / f"{candidate.job_id}.log")
    paths.extend((storage_root / "audio").glob(f"{candidate.job_id}.*"))
    paths.extend((storage_root / "analysis").glob(f"{candidate.job_id}.*"))

    unique_paths: list[Path] = []
    seen: set[Path] = set()
    for path in paths:
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        unique_paths.append(path)
    return unique_paths


def candidate_bytes(storage_root: Path, candidate: CleanupCandidate) -> int:
    total = 0
    for path in artifact_paths(storage_root, candidate):
        if not path.is_file():
            continue
        try:
            total += path.stat().st_size
        except OSError:
            continue
    return total


def _candidate_item(candidate: CleanupCandidate) -> StorageCleanupCandidateItem:
    return StorageCleanupCandidateItem(
        job_id=candidate.job_id,
        provider=candidate.provider,
        source_id=candidate.source_id,
        source_url=candidate.source_url,
        title=candidate.title,
        artist=candidate.artist,
        play_count=candidate.play_count,
        updated_at=candidate.updated_at,
    )


def _reclaimable(
    db_path: Path,
    storage_root: Path,
    days: int,
) -> list[tuple[CleanupCandidate, int]]:
    """Eligible candidates paired with their artifact size.

    Candidates whose artifacts are already gone have nothing left to reclaim, so
    they are dropped rather than reported on every run.
    """
    pairs: list[tuple[CleanupCandidate, int]] = []
    for candidate in find_cleanup_candidates(db_path, days):
        size = candidate_bytes(storage_root, candidate)
        if size > 0:
            pairs.append((candidate, size))
    return pairs


def build_cleanup_preview(
    db_path: Path,
    storage_root: Path,
    days: int = CLEANUP_POLICY_DAYS,
) -> StorageCleanupResponse:
    pairs = _reclaimable(db_path, storage_root, days)
    return StorageCleanupResponse(
        dry_run=True,
        days=days,
        zero_play_days=ZERO_PLAY_GRACE_DAYS,
        candidate_jobs=len(pairs),
        candidate_bytes=sum(size for _, size in pairs),
        candidates=[_candidate_item(candidate) for candidate, _ in pairs],
        cleared_jobs=0,
        freed_bytes=0,
        failed_jobs=0,
        errors=[],
    )


def execute_cleanup(
    db_path: Path,
    storage_root: Path,
    days: int = CLEANUP_POLICY_DAYS,
) -> StorageCleanupResponse:
    pairs = _reclaimable(db_path, storage_root, days)
    cleared_jobs = 0
    freed_bytes = 0
    errors: list[StorageCleanupError] = []

    for candidate, size in pairs:
        if not find_cleanup_candidate_by_id(db_path, candidate.job_id, days):
            continue
        try:
            delete_job_artifacts(candidate.job_id, storage_root)
        except Exception as exc:  # noqa: BLE001 - cleanup should report and continue.
            errors.append(
                StorageCleanupError(
                    job_id=candidate.job_id,
                    error=str(exc) or exc.__class__.__name__,
                )
            )
            continue

        cleared_jobs += 1
        freed_bytes += size

    return StorageCleanupResponse(
        dry_run=False,
        days=days,
        zero_play_days=ZERO_PLAY_GRACE_DAYS,
        candidate_jobs=len(pairs),
        candidate_bytes=sum(size for _, size in pairs),
        candidates=[],
        cleared_jobs=cleared_jobs,
        freed_bytes=freed_bytes,
        failed_jobs=len(errors),
        errors=errors,
    )

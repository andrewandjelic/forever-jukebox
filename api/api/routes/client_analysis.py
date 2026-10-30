"""Browser analysis: the web app analyzes queued jobs itself.

For local setups with no analysis worker (Essentia has no Windows build). Off
unless ALLOW_CLIENT_ANALYSIS is set, because the server stores whatever result
the browser sends.
"""

from __future__ import annotations

import gzip
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from ..db import claim_job_for_client, get_job, set_job_progress, set_job_status
from ..env import env_flag
from ..models import ClientFailureRequest, ClientProgressRequest
from ..paths import DB_PATH, STORAGE_ROOT
from ..route_responses import error_responses
from ..utils import analysis_path_for, audio_path_for
from .jobs_runtime import log_event

router = APIRouter()

# A browser reports progress at least this often while it works, so a claim
# that goes quiet longer (closed tab) can be taken over.
CLIENT_CLAIM_STALE_AFTER = timedelta(minutes=2)
MAX_CLIENT_RESULT_BYTES = 64 * 1024 * 1024
_REQUIRED_LISTS = ("sections", "bars", "beats", "tatums", "segments")


def client_analysis_enabled() -> bool:
    return env_flag("ALLOW_CLIENT_ANALYSIS")


def _claimed_job(job_id: str):
    if not client_analysis_enabled():
        raise HTTPException(status_code=403, detail="Browser analysis is disabled.")
    job = get_job(DB_PATH, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _require_processing(job) -> None:
    if job.status != "processing":
        raise HTTPException(status_code=409, detail="Job is not being analyzed.")


def _looks_like_analysis(data: object) -> bool:
    if not isinstance(data, dict) or not isinstance(data.get("track"), dict):
        return False
    return all(isinstance(data.get(key), list) for key in _REQUIRED_LISTS) and bool(data["beats"])


@router.post("/api/analysis/{job_id}/client/claim", responses=error_responses(403, 404))
def claim_client_analysis(job_id: str) -> JSONResponse:
    _claimed_job(job_id)
    # Until its download finishes there is nothing to analyze.
    if audio_path_for(STORAGE_ROOT, job_id) is None:
        return JSONResponse({"claimed": False})
    stale_before = (datetime.now(timezone.utc) - CLIENT_CLAIM_STALE_AFTER).isoformat()
    return JSONResponse({"claimed": claim_job_for_client(DB_PATH, job_id, stale_before)})


@router.post("/api/analysis/{job_id}/client/progress", responses=error_responses(403, 404, 409))
def report_client_progress(job_id: str, payload: ClientProgressRequest) -> JSONResponse:
    _require_processing(_claimed_job(job_id))
    set_job_progress(DB_PATH, job_id, payload.progress)
    return JSONResponse({"ok": True})


@router.post("/api/analysis/{job_id}/client/result", responses=error_responses(403, 404, 409, 413, 422))
async def submit_client_analysis(job_id: str, request: Request) -> JSONResponse:
    job = _claimed_job(job_id)
    _require_processing(job)
    body = await request.body()
    if len(body) > MAX_CLIENT_RESULT_BYTES:
        raise HTTPException(status_code=413, detail="Analysis is too large.")
    try:
        data = json.loads(body)
    except ValueError:
        raise HTTPException(status_code=422, detail="Analysis is not valid JSON.") from None
    if not _looks_like_analysis(data):
        raise HTTPException(status_code=422, detail="Analysis is missing required fields.")

    # Stored like the worker stores engine output: analysis/<id>.json.gz.
    gz_path = analysis_path_for(STORAGE_ROOT, job_id).with_suffix(".json.gz")
    gz_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = gz_path.with_name(gz_path.name + ".tmp")
    with gzip.open(tmp_path, "wt", encoding="utf-8") as handle:
        json.dump(data, handle)
    tmp_path.replace(gz_path)

    set_job_progress(DB_PATH, job_id, 100)
    set_job_status(DB_PATH, job_id, "complete", None)
    log_event(
        "job_completed",
        job_id=job_id,
        source=job.source_provider or "unknown",
        analyzer="browser",
    )
    return JSONResponse({"status": "complete"})


@router.post("/api/analysis/{job_id}/client/fail", responses=error_responses(403, 404, 409))
def fail_client_analysis(job_id: str, payload: ClientFailureRequest) -> JSONResponse:
    job = _claimed_job(job_id)
    _require_processing(job)
    error = f"Browser analysis failed: {payload.error.strip() or 'unknown error'}"
    set_job_status(DB_PATH, job_id, "failed", error)
    log_event(
        "job_failed",
        job_id=job_id,
        source=job.source_provider or "unknown",
        stage="browser_analysis",
    )
    return JSONResponse({"status": "failed"})

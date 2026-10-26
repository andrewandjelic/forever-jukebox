"""Audio and log file routes."""

from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

from ..db import get_job
from ..paths import DB_PATH, STORAGE_ROOT
from ..route_responses import NOT_FOUND
from ..utils import audio_path_for

router = APIRouter()


@router.get("/api/audio/{job_id}", responses=NOT_FOUND)
def get_audio(job_id: str):
    job = get_job(DB_PATH, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    input_path = audio_path_for(STORAGE_ROOT, job.id)
    if input_path is None or not input_path.exists():
        raise HTTPException(status_code=404, detail="Audio missing")
    return FileResponse(path=str(input_path))


@router.get("/api/logs/{job_id}", responses=NOT_FOUND)
def get_job_log(job_id: str):
    job = get_job(DB_PATH, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    log_path = STORAGE_ROOT / "logs" / f"{job.id}.log"
    if not log_path.exists():
        raise HTTPException(status_code=404, detail="Log not found")
    return FileResponse(path=str(log_path), media_type="text/plain")


# The Jay-Z head-bob button (web JayZBob.tsx) decodes this GIF frame by frame
# to sync it to the beat, which needs same-origin pixels; Tenor sends no CORS
# headers. This fetches that one fixed GIF (not an open proxy) and keeps it in
# memory, so the GIF itself never ships in the repo.
JAYZ_GIF_URL = "https://media1.tenor.com/m/-cHP4n_fT98AAAAC/bobbing-head-bobbing.gif"
_jayz_gif: bytes | None = None


@router.get("/api/media/jayz.gif", responses={502: {"description": "Upstream fetch failed"}})
def get_jayz_gif():
    global _jayz_gif
    if _jayz_gif is None:
        try:
            response = httpx.get(JAYZ_GIF_URL, timeout=15, follow_redirects=True)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="Could not fetch GIF") from exc
        _jayz_gif = response.content
    return Response(
        content=_jayz_gif,
        media_type="image/gif",
        headers={"Cache-Control": "public, max-age=86400"},
    )

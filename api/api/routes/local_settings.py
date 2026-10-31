"""Settings the web app may change on a local jukebox: the Spotify keys.

Off unless ALLOW_LOCAL_SETTINGS is set (Start Jukebox sets it), and only for
requests from this computer, because it writes secrets into api/.env.
"""

from __future__ import annotations

import os

import httpx
from dotenv import set_key, unset_key
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from .. import spotify
from ..env import env_flag
from ..models import SpotifyCredentials
from ..paths import APP_ROOT
from ..route_responses import error_responses

router = APIRouter()

ENV_FILE = APP_ROOT / ".env"
SPOTIFY_KEYS = ("SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET")
LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}


def local_settings_enabled() -> bool:
    return env_flag("ALLOW_LOCAL_SETTINGS")


def _require_local(request: Request) -> None:
    host = request.client.host if request.client else ""
    if not local_settings_enabled() or host not in LOOPBACK_HOSTS:
        raise HTTPException(status_code=403, detail="Settings can only be changed on a local jukebox.")


@router.post("/api/settings/spotify", responses=error_responses(400, 403, 502))
def connect_spotify(payload: SpotifyCredentials, request: Request) -> JSONResponse:
    _require_local(request)
    client_id = payload.client_id.strip()
    client_secret = payload.client_secret.strip()
    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="Enter both the Client ID and the Client Secret.")
    try:
        spotify.check_credentials(client_id, client_secret)
    except httpx.HTTPStatusError:
        raise HTTPException(
            status_code=400,
            detail="Spotify did not accept these keys. Check the Client ID and Client Secret.",
        ) from None
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Could not reach Spotify. Check your internet connection.") from None

    ENV_FILE.touch(exist_ok=True)
    for key, value in zip(SPOTIFY_KEYS, (client_id, client_secret)):
        set_key(ENV_FILE, key, value)
        os.environ[key] = value
    spotify.reset_token_cache()
    return JSONResponse({"spotify_configured": True})


@router.delete("/api/settings/spotify", responses=error_responses(403))
def disconnect_spotify(request: Request) -> JSONResponse:
    _require_local(request)
    for key in SPOTIFY_KEYS:
        if ENV_FILE.exists():
            unset_key(ENV_FILE, key)
        os.environ.pop(key, None)
    spotify.reset_token_cache()
    return JSONResponse({"spotify_configured": False})

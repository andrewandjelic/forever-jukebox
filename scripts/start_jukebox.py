"""Set up and start Forever Jukebox on this computer (Windows or macOS).

"Start Jukebox.cmd" and "Start Jukebox.command" run this once Python, Node.js
and Deno are in place. It sets up the server's Python packages, installs the
web packages and builds the web app and the offline app (again only when the
source changed), then serves everything from one local server and opens it
in the browser. Songs are analyzed in the browser (ALLOW_CLIENT_ANALYSIS), so
no Linux, WSL or Docker is needed.

Standard library only: it runs before the server's packages exist.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API_DIR = ROOT / "api"
VENV = API_DIR / ".venv"
VENV_PYTHON = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
WEB_DIST = ROOT / "web" / "dist"
NPM = "npm.cmd" if os.name == "nt" else "npm"
BUILD_SOURCES = (
    "package-lock.json",
    "web/src", "web/public", "web/index.html", "web/vite.config.ts",
    "pwa/src", "pwa/public", "pwa/index.html", "pwa/vite.config.ts",
    "packages/shared/src",
)
SERVER_START_TIMEOUT_S = 60


def say(text: str) -> None:
    print(text, flush=True)


def fail(text: str) -> None:
    print(f"\n{text}", file=sys.stderr, flush=True)
    sys.exit(1)


def run(command: list[str], error: str) -> None:
    """Run a setup step quietly; its output is shown only if it fails."""
    result = subprocess.run(
        command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace",
    )
    if result.returncode != 0:
        print(result.stdout[-6000:], file=sys.stderr)
        fail(error)


def is_jukebox(port: int) -> bool:
    """True when the jukebox page (not just anything) answers on port."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2) as response:
            return b"Forever Jukebox" in response.read()
    except OSError:
        return False


def port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def ensure_server_packages() -> None:
    """The server's virtualenv, reinstalled when requirements.txt changes."""
    requirements = API_DIR / "requirements.txt"
    wanted = hashlib.sha256(requirements.read_bytes()).hexdigest()
    stamp = VENV / "installed-requirements.sha256"
    if not VENV_PYTHON.exists():
        say("Setting up the jukebox server (one time)...")
        run([sys.executable, "-m", "venv", str(VENV)], "Could not create the Python environment.")
    if not stamp.exists() or stamp.read_text().strip() != wanted:
        say("Installing the server's packages (one time, about a minute)...")
        run(
            [str(VENV_PYTHON), "-m", "pip", "install", "--disable-pip-version-check",
             "--quiet", "-r", str(requirements)],
            "Installing the server's packages did not work. "
            "Check your internet connection and try again.",
        )
        stamp.write_text(wanted)


def newest_source_mtime() -> float:
    newest = 0.0
    for name in BUILD_SOURCES:
        path = ROOT / name
        if path.is_file():
            newest = max(newest, path.stat().st_mtime)
        for folder, _dirs, files in os.walk(path):
            for file in files:
                newest = max(newest, os.stat(os.path.join(folder, file)).st_mtime)
    return newest


def ensure_web_build(rebuild: bool) -> None:
    if not (ROOT / "node_modules").exists():
        say("Installing the web app's packages (one time, a few minutes)...")
        run(
            [NPM, "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
            "Installing the web app's packages did not work. "
            "Check your internet connection and try again.",
        )
    index = WEB_DIST / "index.html"
    built_at = index.stat().st_mtime if index.exists() else 0.0
    if not rebuild and built_at >= newest_source_mtime():
        return
    say("Building the jukebox (a minute or two)...")
    run([NPM, "run", "build", "--workspace=web"], "Building the web app did not work.")
    run([NPM, "run", "build", "--workspace=pwa"], "Building the offline app did not work.")
    # Served at /offline/, as in the Docker image.
    shutil.copytree(ROOT / "pwa" / "dist", WEB_DIST / "offline", dirs_exist_ok=True)


def start_server(port: int) -> subprocess.Popen:
    env = dict(os.environ)
    env.update(
        ALLOW_USER_UPLOAD="true",
        ALLOW_USER_URL="true",
        ALLOW_CLIENT_ANALYSIS="true",
        # Lets Settings > Spotify save keys into api/.env (local requests only).
        ALLOW_LOCAL_SETTINGS="true",
    )
    env.setdefault("MAX_UPLOAD_MB", "200")
    return subprocess.Popen(
        [str(VENV_PYTHON), "-m", "uvicorn", "api.main:app",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=API_DIR,
        env=env,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Start Forever Jukebox.")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--rebuild", action="store_true", help="rebuild the apps even if unchanged")
    parser.add_argument("--no-browser", action="store_true", help="do not open the browser")
    args = parser.parse_args()

    say("\n  Forever Jukebox\n")
    port = args.port
    if is_jukebox(port):
        say(f"The jukebox is already running: http://localhost:{port}/")
        if not args.no_browser:
            webbrowser.open(f"http://localhost:{port}/")
        return

    ensure_server_packages()
    ensure_web_build(args.rebuild)

    while not port_is_free(port):
        port += 1
    say("Starting the jukebox...")
    server = start_server(port)
    deadline = time.monotonic() + SERVER_START_TIMEOUT_S
    while not is_jukebox(port):
        if server.poll() is not None or time.monotonic() > deadline:
            server.kill()
            fail("The jukebox server did not start. Any error is shown above.")
        time.sleep(0.5)

    url = f"http://localhost:{port}/"
    say(f"\n  The jukebox is running at {url}")
    say("  Keep this window open while you use it. Close it to stop the jukebox.\n")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.wait()
    except KeyboardInterrupt:
        pass
    finally:
        if server.poll() is None:
            server.terminate()


if __name__ == "__main__":
    main()

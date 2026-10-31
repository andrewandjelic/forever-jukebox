#!/bin/bash
# Double-click to start Forever Jukebox on a Mac (see "Get started" in
# README.md). Checks for Python and Node.js (opening their download pages when
# missing), installs Deno for YouTube links, then hands over to
# scripts/start_jukebox.py, which sets up, builds and serves the jukebox.

cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.deno/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

pause_and_exit() {
  echo
  read -r -p "Press Return to close this window." _
  exit "$1"
}

# A Python 3.10+; macOS's own python3 is older.
find_python() {
  local candidate
  for candidate in python3.13 python3.12 python3.11 python3.10 python3 \
    /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do
    if command -v "$candidate" >/dev/null 2>&1 &&
      "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node --version | sed -E 's/^v([0-9]+).*/\1/'
}

echo
echo "  Forever Jukebox"
echo

PYTHON="$(find_python)"
missing=()
[[ -z "$PYTHON" ]] && missing+=("Python")
(( $(node_major) < 18 )) && missing+=("Node.js")
if (( ${#missing[@]} > 0 )); then
  echo "Before the jukebox can run, install: ${missing[*]}"
  echo "Their download pages are opening now. Run each installer with its default"
  echo "settings, then double-click Start Jukebox again."
  [[ -z "$PYTHON" ]] && open "https://www.python.org/downloads/macos/"
  (( $(node_major) < 18 )) && open "https://nodejs.org/en/download"
  pause_and_exit 1
fi

# yt-dlp runs YouTube's player script with Deno; without it only uploads work.
if ! command -v deno >/dev/null 2>&1; then
  echo "Installing Deno (for YouTube links)..."
  arch="$(uname -m)"
  [[ "$arch" == "arm64" ]] && arch="aarch64"
  mkdir -p "$HOME/.deno/bin"
  if curl -fsSL "https://github.com/denoland/deno/releases/latest/download/deno-${arch}-apple-darwin.zip" \
      -o /tmp/deno.zip && unzip -o -q /tmp/deno.zip -d "$HOME/.deno/bin"; then
    rm -f /tmp/deno.zip
  else
    echo "Could not install Deno: YouTube links will not work, uploads still will."
  fi
fi

"$PYTHON" scripts/start_jukebox.py "$@" || pause_and_exit $?

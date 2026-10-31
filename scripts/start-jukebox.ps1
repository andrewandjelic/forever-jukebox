# Windows half of "Start Jukebox.cmd": installs what is missing (Python,
# Node.js, and Deno for YouTube links) with winget, then hands over to
# start_jukebox.py, which sets up, builds and serves the jukebox. Arguments
# pass straight through (--port, --rebuild, --no-browser).

$Root = Split-Path -Parent $PSScriptRoot

function Fail([string]$Text) {
  Write-Host ""
  Write-Host $Text -ForegroundColor Red
  exit 1
}

function Update-PathFromRegistry {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Install-WithWinget([string]$Id, [string]$Name) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Fail "$Name is needed. Install it (links under Get started in README.md), then double-click Start Jukebox again."
  }
  Write-Host "Installing $Name. If Windows asks for permission, click Yes." -ForegroundColor Cyan
  winget install --exact --id $Id --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    Fail "Installing $Name did not work. Install it (links under Get started in README.md), then double-click Start Jukebox again."
  }
  Update-PathFromRegistry
}

# A real Python 3.10+, not the Microsoft Store shortcut; returns its path.
function Find-Python {
  $probe = "import sys; print(sys.executable if sys.version_info >= (3, 10) else '')"
  $found = @()
  if (Get-Command py -ErrorAction SilentlyContinue) {
    $found += & py -3 -c $probe 2>$null
  }
  foreach ($cmd in @(Get-Command python -All -ErrorAction SilentlyContinue)) {
    if ($cmd.Source -notlike "*\WindowsApps\*") {
      $found += & $cmd.Source -c $probe 2>$null
    }
  }
  return $found | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

function Get-NodeMajor {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    return 0
  }
  if ((& node --version 2>$null) -match "^v(\d+)\.") {
    return [int]$Matches[1]
  }
  return 0
}

$python = Find-Python
if (-not $python) {
  Install-WithWinget "Python.Python.3.12" "Python"
  $python = Find-Python
}
if ((Get-NodeMajor) -lt 18) {
  Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js"
}
if (-not $python -or (Get-NodeMajor) -lt 18) {
  Fail "Windows has not picked up the new installs yet. Close this window and double-click Start Jukebox again."
}
# yt-dlp runs YouTube's player script with Deno; without it only uploads work.
if (-not (Get-Command deno -ErrorAction SilentlyContinue)) {
  Install-WithWinget "DenoLand.Deno" "Deno (for YouTube links)"
}

& $python (Join-Path $Root "scripts\start_jukebox.py") @args
exit $LASTEXITCODE

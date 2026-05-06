<#
.SYNOPSIS
  Canonical Stitch launcher from stitch-app repo.

.DESCRIPTION
  Runs Stitch from this repo, and calls linkup_mcp only for backend/bridge capabilities.
  This keeps app ownership in stitch-app while reusing bridge code in linkup_mcp.
#>

param(
  [ValidateSet("TauriDev", "Bundled")]
  [string]$Mode = "TauriDev",
  [string]$LinkupRoot
)

$ErrorActionPreference = "Stop"

function Resolve-LinkupRoot {
  param([string]$Explicit)
  $candidates = @()
  if ($Explicit) { $candidates += $Explicit }
  if ($env:LINKUP_MCP_ROOT) { $candidates += $env:LINKUP_MCP_ROOT }
  $candidates += (Join-Path $PSScriptRoot "..\..\cursor_linkup_mcp")
  $candidates += (Join-Path $PSScriptRoot "..\..\linkup_mcp")

  foreach ($cand in $candidates) {
    try {
      $abs = [System.IO.Path]::GetFullPath($cand)
      if (Test-Path (Join-Path $abs "rag.py")) {
        return $abs
      }
    } catch {}
  }
  throw "Could not locate linkup_mcp. Set LINKUP_MCP_ROOT or pass -LinkupRoot."
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$linkupRoot = Resolve-LinkupRoot -Explicit $LinkupRoot

Write-Host ""
Write-Host "=== Stitch launcher (stitch-app canonical) ===" -ForegroundColor Cyan
Write-Host "stitch-app:  $repoRoot" -ForegroundColor DarkGray
Write-Host "linkup_mcp:  $linkupRoot" -ForegroundColor DarkGray
Write-Host ""

if ($Mode -eq "Bundled") {
  Write-Host "Starting bundled single-window mode from stitch-app..." -ForegroundColor Yellow
  $venvPy = Join-Path $linkupRoot ".venv\Scripts\python.exe"
  if (-not (Test-Path $venvPy)) {
    throw "Expected Python venv not found in linkup_mcp: $venvPy"
  }
  $env:LINKUP_MCP_ROOT = $linkupRoot
  & $venvPy (Join-Path $repoRoot "stitch_gui.py") --dist (Join-Path $repoRoot "apps\desktop\dist")
  exit $LASTEXITCODE
}

# TauriDev mode: start bridge from stitch-app, then start desktop.
$venvPy = Join-Path $linkupRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
  throw "Expected Python venv not found in linkup_mcp: $venvPy"
}
$env:LINKUP_MCP_ROOT = $linkupRoot
Write-Host "Starting bridge from stitch-app (using linkup_mcp runtime deps)..." -ForegroundColor DarkGray
Start-Process -FilePath $venvPy -ArgumentList @((Join-Path $repoRoot "stitch_rag_bridge.py")) -WorkingDirectory $repoRoot -WindowStyle Minimized

$deadline = (Get-Date).AddSeconds(45)
$ready = $false
while ((Get-Date) -lt $deadline) {
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:8765/api/health" -TimeoutSec 2
    if ($h.ok) { $ready = $true; break }
  } catch {}
  Start-Sleep -Milliseconds 400
}
if (-not $ready) {
  Write-Warning "Bridge did not answer on /api/health in time."
}

Push-Location $repoRoot
try {
  npm run dev
} finally {
  Pop-Location
}

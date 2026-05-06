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
      if (Test-Path (Join-Path $abs "stitch_rag_bridge.py")) {
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
  Write-Host "Delegating bundled single-window mode to linkup_mcp/stitch_gui.py..." -ForegroundColor Yellow
  $cmd = Join-Path $linkupRoot "scripts\Start-Stitch.ps1"
  if (-not (Test-Path $cmd)) {
    throw "Expected launcher not found: $cmd"
  }
  & powershell -NoProfile -ExecutionPolicy Bypass -File $cmd -Mode Bundled
  exit $LASTEXITCODE
}

# TauriDev mode: delegate bridge + tauri startup to linkup helper.
$desktopScript = Join-Path $linkupRoot "scripts\Start-StitchDesktop.ps1"
if (-not (Test-Path $desktopScript)) {
  throw "Expected desktop launcher not found: $desktopScript"
}
Write-Host "Delegating Tauri + bridge startup to linkup_mcp..." -ForegroundColor Yellow
& powershell -NoProfile -ExecutionPolicy Bypass -File $desktopScript
exit $LASTEXITCODE

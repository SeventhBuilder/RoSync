[CmdletBinding()]
param(
  [switch]$KeepProjects,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME "AppData\Local" }
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$pluginInstallPath = Join-Path $localAppData "Roblox\Plugins\RoSync.plugin.lua"
$shimDir = Join-Path $localAppData "RoSync\bin"
$shimCmdPath = Join-Path $shimDir "rosync.cmd"
$shimPs1Path = Join-Path $shimDir "rosync.ps1"
$metaDir = Join-Path $localAppData "RoSync\meta"
$installPathFile = Join-Path $metaDir "install-path"
$installMetadataPath = Join-Path $metaDir "install.json"
$extensionId = "rosync.rosync-extension"

function Get-ExtensionInstallRoots {
  $roots = [System.Collections.Generic.List[string]]::new()
  $roots.Add((Join-Path $HOME ".vscode\extensions"))

  $cursorProfileDir = Join-Path $HOME ".cursor"
  if (Test-Path -LiteralPath $cursorProfileDir) {
    $roots.Add((Join-Path $cursorProfileDir "extensions"))
  }

  return $roots
}

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message"
}

function Confirm-Uninstall {
  if ($Yes) {
    return
  }

  $answer = Read-Host "Remove RoSync tooling from this system? (y/N)"
  if ($answer -notin @("y", "Y", "yes", "YES")) {
    Write-Host "Cancelled."
    exit 0
  }
}

function Remove-PathEntry {
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $userPath) {
    return
  }

  $normalizedShimDir = $shimDir.TrimEnd("\")
  $entries = $userPath.Split(";") | Where-Object { $_ -and $_.Trim() -ne "" }
  $remaining = @($entries | Where-Object { $_.Trim().TrimEnd("\") -ine $normalizedShimDir })
  if ($remaining.Count -eq $entries.Count) {
    return
  }

  [Environment]::SetEnvironmentVariable("Path", ($remaining -join ";"), "User")
}

function Stop-RoSyncDaemon {
  try {
    $connections = Get-NetTCPConnection -State Listen -LocalPort 34872 -ErrorAction Stop |
      Where-Object { $_.LocalAddress -eq "127.0.0.1" -or $_.LocalAddress -eq "::1" } |
      Select-Object -ExpandProperty OwningProcess -Unique

    foreach ($processId in $connections) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
  } catch {
  }
}

function Uninstall-EditorExtension {
  foreach ($root in Get-ExtensionInstallRoots) {
    if (-not (Test-Path -LiteralPath $root)) {
      continue
    }

    Get-ChildItem -LiteralPath $root -Directory -Filter "$extensionId-*" -ErrorAction SilentlyContinue |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }

  if (Get-Command code -ErrorAction SilentlyContinue) {
    try {
      & code --uninstall-extension $extensionId | Out-Null
    } catch {
    }
  }
}

function Get-SourceInfo {
  $sourceDir = $repoRoot
  $sourceMode = "linked"

  if (Test-Path -LiteralPath $installMetadataPath) {
    try {
      $metadataJson = (Get-Content -LiteralPath $installMetadataPath -Raw) -replace "^\uFEFF", ""
      $metadata = $metadataJson | ConvertFrom-Json
      if ($metadata.sourceDir) {
        $sourceDir = [string]$metadata.sourceDir
      }
      if ($metadata.sourceMode) {
        $sourceMode = [string]$metadata.sourceMode
      }
    } catch {
    }
  }

  return [pscustomobject]@{
    SourceDir = $sourceDir
    SourceMode = $sourceMode
  }
}

Confirm-Uninstall

$sourceInfo = Get-SourceInfo

Write-Step "Stopping RoSync daemon processes on localhost:34872"
Stop-RoSyncDaemon

Write-Step "Removing CLI shims"
Remove-Item -LiteralPath $shimCmdPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $shimPs1Path -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $shimDir -Force -ErrorAction SilentlyContinue
Remove-PathEntry

Write-Step "Removing Roblox Studio plugin"
Remove-Item -LiteralPath $pluginInstallPath -Force -ErrorAction SilentlyContinue

Write-Step "Removing install metadata"
Remove-Item -LiteralPath $installMetadataPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $installPathFile -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $metaDir -Force -ErrorAction SilentlyContinue

Write-Step "Removing editor extension (best effort)"
Uninstall-EditorExtension

if ($sourceInfo.SourceMode -eq "managed" -and (Test-Path -LiteralPath $sourceInfo.SourceDir)) {
  Write-Step "Removing managed source checkout"
  Remove-Item -LiteralPath $sourceInfo.SourceDir -Recurse -Force -ErrorAction SilentlyContinue
} else {
  Write-Host "Leaving linked source checkout in place: $($sourceInfo.SourceDir)"
}

if (-not $KeepProjects) {
  Write-Host "Project-local .rosync cache cleanup is not automated yet; leaving project folders untouched."
}

Write-Host ""
Write-Host "RoSync has been removed from this machine."
Write-Host "Project source folders remain untouched."

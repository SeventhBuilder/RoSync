[CmdletBinding()]
param(
  [switch]$SkipNpmInstall,
  [switch]$SkipBuild,
  [switch]$PluginOnly,
  [switch]$NoPath,
  [switch]$SkipEditorExtension,
  [switch]$SkipVsCodeExtension,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME "AppData\Local" }
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$pluginSource = Join-Path $repoRoot "plugin\RoSync.plugin.luau"
$pluginInstallDir = Join-Path $localAppData "Roblox\Plugins"
$pluginInstallPath = Join-Path $pluginInstallDir "RoSync.plugin.lua"
$shimDir = Join-Path $localAppData "RoSync\bin"
$shimCmdPath = Join-Path $shimDir "rosync.cmd"
$shimPs1Path = Join-Path $shimDir "rosync.ps1"
$metaDir = Join-Path $localAppData "RoSync\meta"
$installPathFile = Join-Path $metaDir "install-path"
$installMetadataPath = Join-Path $metaDir "install.json"
$daemonEntry = Join-Path $repoRoot "daemon\dist\main.js"
$extensionId = "rosync.rosync-extension"

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message"
}

function Require-Command {
  param([string]$CommandName)

  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "Required command '$CommandName' was not found on PATH."
  }
}

function Invoke-InRepo {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  Push-Location $repoRoot
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      $joinedArguments = if ($Arguments.Count -gt 0) {
        $Arguments -join " "
      } else {
        ""
      }
      throw "Command failed: $FilePath $joinedArguments"
    }
  } finally {
    Pop-Location
  }
}

function Install-Plugin {
  if (-not (Test-Path -LiteralPath $pluginSource)) {
    throw "Bundled plugin was not found at $pluginSource. Run the build step first."
  }

  Write-Step "Installing Roblox Studio plugin"
  New-Item -ItemType Directory -Force -Path $pluginInstallDir | Out-Null
  Copy-Item -LiteralPath $pluginSource -Destination $pluginInstallPath -Force
}

function Install-Shims {
  if (-not (Test-Path -LiteralPath $daemonEntry)) {
    throw "Built daemon entrypoint was not found at $daemonEntry. Run the build step first."
  }

  Write-Step "Writing local RoSync CLI shims"
  New-Item -ItemType Directory -Force -Path $shimDir | Out-Null

  $cmdContents = @"
@echo off
node "$daemonEntry" %*
"@

  $ps1Contents = @"
param(
  [Parameter(ValueFromRemainingArguments = `$true)]
  [string[]]`$Arguments
)

& node "$daemonEntry" @Arguments
"@

  Set-Content -LiteralPath $shimCmdPath -Value $cmdContents -Encoding ASCII
  Set-Content -LiteralPath $shimPs1Path -Value $ps1Contents -Encoding ASCII
}

function Add-ShimDirToUserPath {
  if ($NoPath) {
    return
  }

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $entries = @()
  if ($userPath) {
    $entries = $userPath.Split(";") | Where-Object { $_ -and $_.Trim() -ne "" }
  }

  $normalizedShimDir = $shimDir.TrimEnd("\")
  $alreadyPresent = $entries | Where-Object { $_.Trim().TrimEnd("\") -ieq $normalizedShimDir }
  if ($alreadyPresent) {
    return
  }

  $nextEntries = @($entries + $shimDir)
  [Environment]::SetEnvironmentVariable("Path", ($nextEntries -join ";"), "User")
  Write-Host "Added $shimDir to your user PATH. Open a new terminal to use `rosync`."
}

function Write-InstallMetadata {
  $now = (Get-Date).ToUniversalTime().ToString("o")
  $installedAt = $now

  if (Test-Path -LiteralPath $installMetadataPath) {
    try {
      $existing = Get-Content -LiteralPath $installMetadataPath -Raw | ConvertFrom-Json
      if ($existing.installedAt) {
        $installedAt = [string]$existing.installedAt
      }
    } catch {
    }
  }

  $metadata = [ordered]@{
    version = 1
    installedAt = $installedAt
    updatedAt = $now
    platform = "win32"
    sourceDir = $repoRoot
    sourceMode = "linked"
    metaDir = $metaDir
    cliEntry = $daemonEntry
    cliLaunchers = @($shimCmdPath, $shimPs1Path)
    pluginSource = $pluginSource
    pluginInstallPath = $pluginInstallPath
    installScript = Join-Path $repoRoot "install\windows\install.ps1"
    uninstallScript = Join-Path $repoRoot "install\windows\uninstall.ps1"
    extensionId = $extensionId
  }

  New-Item -ItemType Directory -Force -Path $metaDir | Out-Null
  Set-Content -LiteralPath $installPathFile -Value $repoRoot -Encoding ASCII
  $metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $installMetadataPath -Encoding UTF8
}

function Install-EditorExtension {
  if ($SkipEditorExtension -or $SkipVsCodeExtension) {
    return
  }

  if (Get-Command code -ErrorAction SilentlyContinue) {
    Write-Host "Editor extension packaging is not automated in the source installer yet. The current first-party editor extension target is VS Code."
  }
}

if ($Uninstall) {
  & (Join-Path $repoRoot "install\windows\uninstall.ps1")
  exit $LASTEXITCODE
}

Require-Command "node"
if (-not $PluginOnly) {
  Require-Command "npm"
}

if (-not $PluginOnly -and -not $SkipNpmInstall) {
  Write-Step "Installing npm dependencies"
  Invoke-InRepo -FilePath "npm" -Arguments @("install")
}

if (-not $SkipBuild) {
  if ($PluginOnly) {
    Write-Step "Bundling Studio plugin"
    Invoke-InRepo -FilePath "node" -Arguments @("plugin/tools/bundle.mjs")
  } else {
    Write-Step "Building daemon and editor extension"
    Invoke-InRepo -FilePath "npm" -Arguments @("run", "build")
    Write-Step "Bundling Studio plugin"
    Invoke-InRepo -FilePath "node" -Arguments @("plugin/tools/bundle.mjs")
  }
}

Install-Plugin

if (-not $PluginOnly) {
  Install-Shims
  Add-ShimDirToUserPath
  Write-InstallMetadata
  Install-EditorExtension
}

Write-Host ""
Write-Host "Installed:"
Write-Host "  Plugin: $pluginInstallPath"
if (-not $PluginOnly) {
  Write-Host "  CLI shim: $shimCmdPath"
  Write-Host "  Metadata: $installMetadataPath"
}

Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Open your RoSync project folder in a new terminal session."
if (-not $PluginOnly) {
  Write-Host "  2. Start the daemon with: rosync watch"
} else {
  Write-Host "  2. Start the daemon with: node $daemonEntry watch"
}
Write-Host "  3. In Roblox Studio, open the RoSync plugin."
Write-Host "  4. The daemon will bind to http://127.0.0.1:34872 by default."

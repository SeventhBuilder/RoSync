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
$extensionSourceDir = Join-Path $repoRoot "extension"
$extensionManifestPath = Join-Path $extensionSourceDir "package.json"
$extensionEntry = Join-Path $extensionSourceDir "dist\extension.js"
$script:extensionInstallPaths = @()
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

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
      $existingJson = (Get-Content -LiteralPath $installMetadataPath -Raw) -replace "^\uFEFF", ""
      $existing = $existingJson | ConvertFrom-Json
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
  $metadataJson = $metadata | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($installMetadataPath, $metadataJson, $utf8NoBom)
}

function Get-ExtensionManifest {
  if (-not (Test-Path -LiteralPath $extensionManifestPath)) {
    throw "Extension manifest was not found at $extensionManifestPath."
  }

  try {
    $manifestJson = (Get-Content -LiteralPath $extensionManifestPath -Raw) -replace "^\uFEFF", ""
    $manifest = $manifestJson | ConvertFrom-Json
  } catch {
    throw "Unable to parse the extension manifest at $extensionManifestPath."
  }

  if (-not $manifest.publisher -or -not $manifest.name -or -not $manifest.version) {
    throw "Extension manifest is missing publisher, name, or version."
  }

  return $manifest
}

function Get-ExtensionInstallRoots {
  $roots = [System.Collections.Generic.List[string]]::new()
  $roots.Add((Join-Path $HOME ".vscode\extensions"))

  $cursorProfileDir = Join-Path $HOME ".cursor"
  if (Test-Path -LiteralPath $cursorProfileDir) {
    $roots.Add((Join-Path $cursorProfileDir "extensions"))
  }

  return $roots
}

function Copy-ExtensionRuntimeDependencies {
  param(
    [pscustomobject]$Manifest,
    [string]$Destination
  )

  $dependencyNames = @()
  if ($Manifest.dependencies) {
    $dependencyNames = @($Manifest.dependencies.PSObject.Properties.Name)
  }

  if ($dependencyNames.Length -eq 0) {
    return
  }

  $repoNodeModules = Join-Path $repoRoot "node_modules"
  if (-not (Test-Path -LiteralPath $repoNodeModules)) {
    throw "Workspace node_modules was not found at $repoNodeModules. Run npm install first."
  }

  $destinationNodeModules = Join-Path $Destination "node_modules"
  if (Test-Path -LiteralPath $destinationNodeModules) {
    Remove-Item -LiteralPath $destinationNodeModules -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $destinationNodeModules | Out-Null

  foreach ($dependencyName in $dependencyNames) {
    $dependencyParts = $dependencyName.Split("/")
    $relativePath = $dependencyParts[0]
    for ($index = 1; $index -lt $dependencyParts.Count; $index += 1) {
      $relativePath = Join-Path $relativePath $dependencyParts[$index]
    }

    $sourcePath = Join-Path $repoNodeModules $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath)) {
      throw "Runtime dependency '$dependencyName' was not found at $sourcePath."
    }

    $destinationPath = Join-Path $destinationNodeModules $relativePath
    $destinationParent = Split-Path -Path $destinationPath -Parent
    New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Recurse -Force
  }
}

function Install-EditorExtension {
  if ($SkipEditorExtension -or $SkipVsCodeExtension) {
    return
  }

  if (-not (Test-Path -LiteralPath $extensionEntry)) {
    throw "Built extension entrypoint was not found at $extensionEntry. Run the build step first."
  }

  $manifest = Get-ExtensionManifest
  $resolvedExtensionId = "$($manifest.publisher).$($manifest.name)"
  $targetFolderName = "$resolvedExtensionId-$($manifest.version)"
  $script:extensionInstallPaths = @()

  Write-Step "Installing editor extension"
  foreach ($root in Get-ExtensionInstallRoots) {
    New-Item -ItemType Directory -Force -Path $root | Out-Null

    Get-ChildItem -LiteralPath $root -Directory -Filter "$resolvedExtensionId-*" -ErrorAction SilentlyContinue |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

    $destination = Join-Path $root $targetFolderName
    Copy-Item -LiteralPath $extensionSourceDir -Destination $destination -Recurse -Force
    Copy-ExtensionRuntimeDependencies -Manifest $manifest -Destination $destination
    $script:extensionInstallPaths += $destination
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
  foreach ($installedExtensionPath in $script:extensionInstallPaths) {
    Write-Host "  Editor extension: $installedExtensionPath"
  }
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

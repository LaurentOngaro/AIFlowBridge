param(
  [ValidateSet('stable', 'insiders')]
  [string]$Quality = 'stable',

  [switch]$AllProfiles,

  [string[]]$Profiles = @()
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$distDir = Join-Path $workspaceRoot 'dist'

switch ($Quality) {
  'stable' {
    $cli = 'code'
    $installHint = "Shell Command: Install 'code' command in PATH"
  }
  'insiders' {
    $cli = 'code-insiders'
    $installHint = "Shell Command: Install 'code-insiders' command in PATH"
  }
}

if (-not (Get-Command $cli -ErrorAction SilentlyContinue)) {
  throw "Missing '$cli' in PATH. Install it from the VS Code Command Palette using: $installHint"
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(Mandatory = $true)]
    [string[]]$ArgumentList
  )

  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $FilePath $($ArgumentList -join ' ')"
  }
}

# Direct file manipulation functions

function Add-ExtensionToProfile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$VsixPath,
    [Parameter(Mandatory = $true)]
    [string]$ProfileFolder
  )

  $extensionsFile = Join-Path $ProfileFolder 'extensions.json'
  if (-not (Test-Path $extensionsFile)) {
    Write-Warning "No extensions.json in profile '$ProfileFolder', skipping"
    return $false
  }

  # Read VSIX to get extension ID and version
  $tempDir = Join-Path $env:TEMP "aiflowbridge-vsix-$([System.Guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  try {
    # Extract VSIX (it's a ZIP file)
    Expand-Archive -Path $VsixPath -DestinationPath $tempDir -Force
    $extensionManifest = Get-Content (Join-Path $tempDir 'extension/package.json') -Raw | ConvertFrom-Json
    $extensionId = $extensionManifest.publisher + '.' + $extensionManifest.name
    $version = $extensionManifest.version
  } finally {
    Remove-Item -Path $tempDir -Recurse -Force
  }

  # Read existing extensions.json
  $jsonContent = Get-Content $extensionsFile -Raw
  $extensions = @()
  try {
    $extensions = @($jsonContent | ConvertFrom-Json)
  } catch {
    # File exists but invalid JSON - skip
    Write-Warning "Invalid extensions.json in profile '$ProfileFolder', skipping"
    return $false
  }

  # Check if extension already exists
  $alreadyInstalled = $false
  foreach ($ext in $extensions) {
    if ($ext.identifier.id -like ($extensionId + '*')) {
      $alreadyInstalled = $true
      break
    }
  }

  if ($alreadyInstalled) {
    Write-Host "  Extension $extensionId already installed in profile '$ProfileFolder'"
    return $true
  }

  # Add extension to list
  $newEntry = @{
    identifier = @{
      id = $extensionId
      uuid = [System.Guid]::NewGuid().ToString()
    }
    displayName = $extensionManifest.displayName
    applicationScoped = $false
  }

  $newExtensions = @($extensions) + @($newEntry)
  $newJson = $newExtensions | ConvertTo-Json -Depth 100
  Set-Content -Path $extensionsFile -Value $newJson -Force

  Write-Host "  Added $extensionId to profile '$ProfileFolder'"
  return $true
}

function Remove-ExtensionFromProfile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ExtensionId,
    [Parameter(Mandatory = $true)]
    [string]$ProfileFolder
  )

  $extensionsFile = Join-Path $ProfileFolder 'extensions.json'
  if (-not (Test-Path $extensionsFile)) {
    return $false
  }

  $jsonContent = Get-Content $extensionsFile -Raw
  $extensions = @()
  try {
    $extensions = @($jsonContent | ConvertFrom-Json)
  } catch {
    return $false
  }

  $originalCount = $extensions.Count
  $extensions = @($extensions | Where-Object { $_.identifier.id -notlike ($ExtensionId + '*') })

  if ($extensions.Count -eq $originalCount) {
    return $false
  }

  $newJson = $extensions | ConvertTo-Json -Depth 100
  Set-Content -Path $extensionsFile -Value $newJson -Force

  Write-Host "  Removed $ExtensionId from profile '$ProfileFolder'"
  return $true
}

Push-Location $workspaceRoot
try {
  Write-Host "Building extension in $workspaceRoot"
  Invoke-CheckedCommand -FilePath 'npm' -ArgumentList @('run', 'compile')
  Invoke-CheckedCommand -FilePath 'npm' -ArgumentList @('run', 'package')

  $vsix = Get-ChildItem -Path $distDir -Filter 'aiflowbridge-*.vsix' -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $vsix) {
    throw "No VSIX found in '$distDir'."
  }

  # Collect all profile folders from all known locations
  $allProfileFolders = @()

  # Scan APPDATA profiles
  $appDataProfilesRoot = Join-Path $env:APPDATA 'Code\User\profiles'
  if (Test-Path $appDataProfilesRoot) {
    Get-ChildItem -Path $appDataProfilesRoot -Directory | ForEach-Object {
      $allProfileFolders += $_.FullName
    }
  }

  # # Scan H: share profiles if different from APPDATA
  # $hProfilesRoot = 'H:\Share\windows_profiles\VSCode\User\profiles'
  # if ((Test-Path $hProfilesRoot) -and ($hProfilesRoot -ne $appDataProfilesRoot)) {
  #   Get-ChildItem -Path $hProfilesRoot -Directory | ForEach-Object {
  #     if ($allProfileFolders -notcontains $_.FullName) {
  #       $allProfileFolders += $_.FullName
  #     }
  #   }
  # }

  if ($allProfileFolders.Count -eq 0) {
    throw "No profile folders found."
  }

  # Determine target profiles
  $targets = @()
  if ($Profiles.Count -gt 0) {
    $targets = $Profiles
  } elseif ($AllProfiles) {
    $targets = $allProfileFolders
  } else {
    # Interactive selection by folder index
    Write-Host "Available profile folders found:`n"
    for ($i = 0; $i -lt $allProfileFolders.Count; $i++) {
      $idx = $i + 1
      Write-Host " [$idx] $($allProfileFolders[$i])"
    }
    Write-Host "`nEnter comma-separated indices to install into (e.g. 1,3), or 'a' for all, or empty to cancel:"
    $inputVal = Read-Host "Select profiles"
    if ([string]::IsNullOrWhiteSpace($inputVal)) {
      Write-Host "Cancelled."
      return
    } elseif ($inputVal.Trim().ToLower() -eq 'a') {
      $targets = $allProfileFolders
    } else {
      $indices = $inputVal -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^[0-9]+$' } | ForEach-Object { [int]$_ }
      foreach ($n in $indices) {
        if ($n -ge 1 -and $n -le $allProfileFolders.Count) {
          $targets += $allProfileFolders[$n - 1]
        }
      }
    }
  }

  if ($targets.Count -eq 0) {
    Write-Host "No profiles selected, nothing to install."
    return
  }

  foreach ($target in $targets) {
    Write-Host "Installing into profile folder: $target"
    try {
      Add-ExtensionToProfile -VsixPath $vsix.FullName -ProfileFolder $target
    } catch {
      Write-Warning "Failed to install into profile folder '$target': $_"
      continue
    }
  }

  Write-Host ''
  Write-Host "Done. VSIX: $($vsix.FullName)"
  Write-Host ''
  Write-Host "NOTE: Restart VS Code for the extension to appear in the profile."
}
finally {
  Pop-Location
}

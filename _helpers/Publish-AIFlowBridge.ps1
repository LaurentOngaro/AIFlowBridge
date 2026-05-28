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

  # Determine target profiles
  $profilesRoot = Join-Path $env:APPDATA 'Code\User\profiles'
  $availableProfiles = @()
  if (Test-Path $profilesRoot) {
    $availableProfiles = Get-ChildItem -Path $profilesRoot -Directory | Sort-Object Name | ForEach-Object {
      [PSCustomObject]@{
        Folder = $_.Name
        Path = $_.FullName
        Display = $_.Name
      }
    }
  }

  # If explicit profiles passed, use them
  $targets = @()
  if ($Profiles.Count -gt 0) {
    $targets = $Profiles
  } elseif ($AllProfiles -and $availableProfiles.Count -gt 0) {
    $targets = $availableProfiles | ForEach-Object { $_.Folder }
  } elseif ($availableProfiles.Count -gt 0) {
    # Interactive selection
    Write-Host "Available profiles found:`n"
    for ($i = 0; $i -lt $availableProfiles.Count; $i++) {
      $idx = $i + 1
      Write-Host " [$idx] $($availableProfiles[$i].Display)"
    }
    Write-Host "`nEnter comma-separated indices to install into (e.g. 1,3), or 'a' for all, or empty to install into active profile:"
    $inputVal = Read-Host "Select profiles"
    if ([string]::IsNullOrWhiteSpace($inputVal)) {
      $targets = @()
    } elseif ($inputVal.Trim().ToLower() -eq 'a') {
      $targets = $availableProfiles | ForEach-Object { $_.Folder }
    } else {
      $indices = $inputVal -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^[0-9]+$' } | ForEach-Object { [int]$_ }
      $sel = @()
      foreach ($n in $indices) {
        if ($n -ge 1 -and $n -le $availableProfiles.Count) { $sel += $availableProfiles[$n - 1].Folder }
      }
      $targets = $sel
    }
  } else {
    $targets = @()
  }

  if ($targets.Count -eq 0) {
    Write-Host "Installing $($vsix.Name) into the active/default profile"
    Invoke-CheckedCommand -FilePath $cli -ArgumentList @('--install-extension', $vsix.FullName, '--force')
  } else {
    foreach ($target in $targets) {
      Write-Host "Installing $($vsix.Name) into profile '$target'"
      try {
        # Use --profile=<name> form to avoid ambiguous parsing when profile names start with '-'
        $arg = "--profile=$target"
        Invoke-CheckedCommand -FilePath $cli -ArgumentList @($arg, '--install-extension', $vsix.FullName, '--force')
      } catch {
        Write-Warning "Failed to install into profile '$target': $_"
        continue
      }
    }
  }

  Write-Host ''
  Write-Host "Done. VSIX: $($vsix.FullName)"
}
finally {
  Pop-Location
}

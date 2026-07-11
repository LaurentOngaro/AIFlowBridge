param(
  [string]$Source = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,

  [string]$Destination = 'D:\Projets_Perso\03_Code\_Extensions\vsCode\aiflowbridge-server-win-x64',

  [string]$TaskName = 'AIFlowBridge Standalone',

  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(Mandatory = $true)]
    [string[]]$ArgumentList
  )

  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed (exit $LASTEXITCODE): $FilePath $($ArgumentList -join ' ')"
  }
}

function Invoke-CheckedRobocopy {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePath,

    [Parameter(Mandatory = $true)]
    [string]$DestinationPath
  )

  robocopy $SourcePath $DestinationPath /MIR | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed (exit $LASTEXITCODE): $SourcePath -> $DestinationPath"
  }
}

function Test-ScheduledTaskRegistered {
  param([Parameter(Mandatory = $true)][string]$Name)
  $null = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  return $?
}

function Test-ScheduledTaskRunning {
  param([Parameter(Mandatory = $true)][string]$Name)
  $info = Get-ScheduledTaskInfo -TaskName $Name -ErrorAction SilentlyContinue
  return ($info -ne $null -and $info.Status -eq 'Running')
}

function Stop-ManualServer {
  param([Parameter(Mandatory = $true)][string]$InstallPath)
  $marker = Join-Path $InstallPath 'dist\standalone\main.js'
  if (-not (Test-Path -LiteralPath $marker)) {
    return
  }

  $escaped = $marker.Replace('\', '\\')
  $query = "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'node.exe' AND CommandLine LIKE '%$escaped%'"
  $matches = Get-CimInstance -Query $query -ErrorAction SilentlyContinue
  foreach ($p in $matches) {
    Write-Host "Stopping manual server (PID $($p.ProcessId))..."
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path -LiteralPath $Destination)) {
  throw "Destination not found: $Destination"
}

Write-Host "Source:      $Source"
Write-Host "Destination: $Destination"

$taskRegistered = Test-ScheduledTaskRegistered -Name $TaskName
$taskWasRunning = $false

if ($taskRegistered) {
  $taskWasRunning = Test-ScheduledTaskRunning -Name $TaskName
  if ($taskWasRunning) {
    Write-Host "Stopping scheduled task '$TaskName'..."
    Stop-ScheduledTask -TaskName $TaskName | Out-Null
    Start-Sleep -Seconds 1
  } else {
    Write-Host "Scheduled task '$TaskName' is registered but not running."
  }
} else {
  Write-Host "Scheduled task '$TaskName' is not registered (manual launch mode)."
}

Stop-ManualServer -InstallPath $Destination

if (-not $SkipBuild) {
  Push-Location $Source
  try {
    Write-Host "Running npm ci..."
    Invoke-CheckedCommand -FilePath 'npm' -ArgumentList @('ci')
    Write-Host "Running npm run build:standalone..."
    Invoke-CheckedCommand -FilePath 'npm' -ArgumentList @('run', 'build:standalone')
  } finally {
    Pop-Location
  }
} else {
  Write-Host "Skipping build (using existing dist/)."
}

Write-Host "Copying files to $Destination ..."
Invoke-CheckedRobocopy -SourcePath (Join-Path $Source 'dist\standalone') -DestinationPath (Join-Path $Destination 'dist\standalone')
Invoke-CheckedRobocopy -SourcePath (Join-Path $Source 'dist\aiflowbridge') -DestinationPath (Join-Path $Destination 'dist\aiflowbridge')

foreach ($module in 'logger.js','config.js','consts.js','types.js','json.js') {
  $src = Join-Path (Join-Path $Source 'dist') $module
  $dst = Join-Path (Join-Path $Destination 'dist') $module
  if (-not (Test-Path -LiteralPath $src)) {
    throw "Expected build artifact missing: $src"
  }
  Copy-Item -LiteralPath $src -Destination $dst -Force
}

$resourcesDir = Join-Path $Destination 'resources'
if (-not (Test-Path -LiteralPath $resourcesDir)) {
  New-Item -ItemType Directory -Path $resourcesDir -Force | Out-Null
}
Copy-Item -LiteralPath (Join-Path $Source 'resources\models.json') -Destination (Join-Path $resourcesDir 'models.json') -Force
Copy-Item -LiteralPath (Join-Path $Source 'package.json') -Destination (Join-Path $Destination 'package.json') -Force

if ($taskRegistered -and $taskWasRunning) {
  Write-Host "Restarting scheduled task '$TaskName'..."
  Start-ScheduledTask -TaskName $TaskName | Out-Null
} elseif (-not $taskRegistered) {
  Write-Host "Restart the manual server with: $Destination\bin\aiflowbridge-server.cmd"
}

Write-Host "Done."
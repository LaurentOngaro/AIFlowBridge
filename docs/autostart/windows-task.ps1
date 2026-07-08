<#
.SYNOPSIS
  Register a Windows Scheduled Task that runs the AIFlowBridge standalone gateway at user logon.

.DESCRIPTION
  Creates a scheduled task under the current user. The task:
    - runs at logon,
    - runs only when the user is logged on (interactive session, not background),
    - restarts on failure (every 1 minute),
    - inherits the user environment (so AIFLOWBRIDGE_*_API_KEY env vars are picked up).

.PARAMETER NodePath
  Absolute path to the node.exe binary.

.PARAMETER ScriptPath
  Absolute path to the compiled main.js entry point (dist/standalone/main.js).

.PARAMETER TaskName
  Name of the scheduled task to register. Defaults to "AIFlowBridge Standalone Gateway".

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File windows-task.ps1 `
    -NodePath "C:\Program Files\nodejs\node.exe" `
    -ScriptPath "C:\path\to\AIFlowBridge\dist\standalone\main.js"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$NodePath,

    [Parameter(Mandatory = $true)]
    [string]$ScriptPath,

    [Parameter(Mandatory = $false)]
    [string]$TaskName = "AIFlowBridge Standalone Gateway"
)

if (-not (Test-Path -LiteralPath $NodePath)) {
    throw "Node not found at $NodePath. Install Node.js 20+ or pass -NodePath."
}

if (-not (Test-Path -LiteralPath $ScriptPath)) {
    throw "main.js not found at $ScriptPath. Run 'npm run build:standalone' first."
}

# Idempotent: unregister any existing task with the same name.
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute $NodePath -Argument "`"$ScriptPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0)

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Runs the AIFlowBridge standalone OpenAI-compatible gateway at user logon. Inherits AIFLOWBRIDGE_*_API_KEY env vars for upstream provider auth."

Write-Host "[AIFlowBridge] Scheduled task '$TaskName' registered."
Write-Host "[AIFlowBridge]   node:  $NodePath"
Write-Host "[AIFlowBridge]   entry: $ScriptPath"
Write-Host "[AIFlowBridge] Run 'Start-ScheduledTask -TaskName \"$TaskName\"' to start it now, or just log out and back in."
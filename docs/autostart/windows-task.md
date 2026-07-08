# Autostart on Windows (Task Scheduler)

Windows does not have a direct equivalent to systemd / launchd, but Task Scheduler gives us the same "run at login" + "restart on failure" semantics with a GUI.

## 1. Build the binary

```powershell
cd C:\path\to\AIFlowBridge
npm ci
npm run build:standalone
```

## 2. Run the setup script

The provided PowerShell script creates a scheduled task that runs the standalone gateway at user logon, restarts it on failure, and inherits the API keys from the user's environment.

```powershell
powershell -ExecutionPolicy Bypass -File docs\autostart\windows-task.ps1 `
  -NodePath "C:\Program Files\nodejs\node.exe" `
  -ScriptPath "C:\path\to\AIFlowBridge\dist\standalone\main.js" `
  -TaskName "AIFlowBridge Standalone Gateway"
```

The API keys must already be set as user environment variables (`AIFLOWBRIDGE_DEEPSEEK_API_KEY`, etc.) for the script to inherit them.
Use `sysdm.cpl` -> Advanced -> Environment Variables to set them.

## 3. Verify

```powershell
Get-ScheduledTask -TaskName "AIFlowBridge Standalone Gateway"
Get-ScheduledTaskInfo -TaskName "AIFlowBridge Standalone Gateway"
```

The task should show `Ready` state and a `LastRunTime` close to "now" (if it has already been triggered).
Hit `http://127.0.0.1:8787/v1/models` to verify.

## 4. (Optional) remove the task

```powershell
Unregister-ScheduledTask -TaskName "AIFlowBridge Standalone Gateway" -Confirm:$false
```

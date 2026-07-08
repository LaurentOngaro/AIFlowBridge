# Autostart on macOS (launchd)

launchd is the macOS service manager. User-level agents run as your user and start at login.

## 1. Build the binary

```bash
cd /path/to/AIFlowBridge
npm ci
npm run build:standalone
```

## 2. Install the plist

Copy [`com.aiflowbridge.server.plist`](./com.aiflowbridge.server.plist) to `~/Library/LaunchAgents/`:

```bash
mkdir -p ~/Library/LaunchAgents
cp docs/autostart/com.aiflowbridge.server.plist ~/Library/LaunchAgents/
```

Edit the `ProgramArguments` and `EnvironmentVariables` to match your setup.

## 3. Load the agent

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.aiflowbridge.server.plist
launchctl enable gui/$(id -u)/com.aiflowbridge.server
launchctl kickstart -k gui/$(id -u)/com.aiflowbridge.server
```

## 4. (Optional) unload

```bash
launchctl bootout gui/$(id -u)/com.aiflowbridge.server
```

# Autostart on Linux (systemd --user)

User-level systemd units run as your user without root, and start automatically on login.

## 1. Build the binary

```bash
cd /path/to/AIFlowBridge
npm ci
npm run build:standalone
```

## 2. Install the unit

Copy [`aiflowbridge.service`](./aiflowbridge.service) to `~/.config/systemd/user/`:

```bash
mkdir -p ~/.config/systemd/user
cp docs/autostart/aiflowbridge.service ~/.config/systemd/user/
```

Edit the `ExecStart=` line to point at your compiled binary, and set the API key env vars to your real keys.

## 3. Enable + start

```bash
systemctl --user daemon-reload
systemctl --user enable aiflowbridge
systemctl --user start aiflowbridge
systemctl --user status aiflowbridge
```

## 4. (Optional) start at boot, not just at login

```bash
loginctl enable-linger $USER
```

Without linger, the unit starts only when you log in interactively (SSH + TTY). With linger, it starts at boot.

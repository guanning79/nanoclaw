---
name: restart-nanoclaw
description: Restart the NanoClaw service. Detects platform and uses the appropriate method (launchctl, systemd, or direct process kill+start on Windows). Verifies the service is back up after restart.
---

# Restart NanoClaw

Stops and restarts the NanoClaw service. Detects the platform automatically.

## Step 1: Detect platform and current state

```bash
uname -s 2>/dev/null || echo "Windows"
```

Also check if running as a managed service:

```bash
# macOS
launchctl list 2>/dev/null | grep nanoclaw

# Linux
systemctl --user is-active nanoclaw 2>/dev/null || systemctl is-active nanoclaw 2>/dev/null
```

## Step 2: Restart

### macOS (launchd)

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

If that fails (service not loaded):

```bash
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

### Linux (systemd)

```bash
systemctl --user restart nanoclaw
```

If not using systemd (WSL without systemd):

```bash
pkill -f "node dist/index.js" || pkill -f "tsx src/index.ts"
sleep 1
cd /path/to/nanoclaw && nohup npm start >> logs/nanoclaw.log 2>&1 &
```

### Windows (direct process)

Find and kill the Node process, then restart:

```bash
# Kill all node processes (or find the specific PID from logs first)
powershell.exe -Command "Stop-Process -Id <PID> -Force"

# Start in background
cd /path/to/nanoclaw
npm start >> logs/nanoclaw.log 2>&1 &
```

To find the PID before killing:

```bash
tasklist | grep node
# Then check logs/nanoclaw.log for the PID in the most recent startup line
```

**Important on Windows:** Use absolute paths in the restart command since shell working directory resets between commands. Append to the existing log file (`>>`) rather than overwriting (`>`).

## Step 3: Verify

Wait 3–5 seconds, then check logs:

```bash
sleep 4 && tail -10 logs/nanoclaw.log
```

Look for:
- `NanoClaw running (trigger: ...)` — service started successfully
- `Discord bot connected` / `Telegram bot connected` / channel connected lines
- `Credential proxy started` — IPC layer up

If the log shows `EADDRINUSE` on port 3001, the previous process is still running. Kill all node processes and retry:

```bash
powershell.exe -Command "Get-Process node | Stop-Process -Force"  # Windows
# or
pkill -f "node\|tsx"  # macOS/Linux
```

## Notes

- On Windows, NanoClaw logs to `logs/nanoclaw.log` relative to the project root.
- The model download on first voice transcription use may make startup appear slow — this is normal.
- After restarting, all active agent sessions resume on the next incoming message.

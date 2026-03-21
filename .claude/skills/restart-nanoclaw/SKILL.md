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

## Step 2.5: Clean up corrupted sessions

Run this **after** killing the process but **before** starting it. It detects and removes sessions that would cause an infinite retry loop on startup.

A session is considered corrupted if:
- Its directory no longer exists on disk (session was force-killed mid-write), OR
- The recent log contains `No message found with message.uuid` errors referencing it

```bash
node -e "
const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database('d:/Dev/Tools/nanoclaw/store/messages.db');
const sessions = db.prepare('SELECT * FROM sessions').all();
let cleared = 0;
for (const { group_folder, session_id } of sessions) {
  const sessionDir = 'd:/Dev/Tools/nanoclaw/data/sessions/' + group_folder + '/.claude/projects/-workspace-group/' + session_id;
  if (!fs.existsSync(sessionDir)) {
    db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(group_folder);
    console.log('Cleared missing session for ' + group_folder + ': ' + session_id);
    cleared++;
  }
}
if (cleared === 0) console.log('All sessions valid');
db.close();
"
```

Also check the recent log for UUID errors and clear any affected sessions:

```bash
# Extract group names from "No message found" errors in recent log
grep -oP "(?<=Container agent error).*" d:/Dev/Tools/nanoclaw/logs/nanoclaw.log 2>/dev/null | tail -20 || true
grep "No message found with message.uuid" d:/Dev/Tools/nanoclaw/logs/nanoclaw.log 2>/dev/null | tail -5 || true
```

If the log shows `No message found with message.uuid of: <uuid>` errors for a group, clear that session:

```bash
node -e "
const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database('d:/Dev/Tools/nanoclaw/store/messages.db');
// Replace GROUP_FOLDER with the actual group folder name (e.g. discord_main)
const GROUP = 'GROUP_FOLDER';
const row = db.prepare('SELECT session_id FROM sessions WHERE group_folder = ?').get(GROUP);
if (row) {
  const sessionDir = 'd:/Dev/Tools/nanoclaw/data/sessions/' + GROUP + '/.claude/projects/-workspace-group/' + row.session_id;
  db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(GROUP);
  try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
  console.log('Cleared session for ' + GROUP + ': ' + row.session_id);
} else {
  console.log('No session found for ' + GROUP);
}
db.close();
"
```

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

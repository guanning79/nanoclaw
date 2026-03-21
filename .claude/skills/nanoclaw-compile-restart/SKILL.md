---
name: nanoclaw-compile-restart
description: Full compile + restart for NanoClaw. Builds src/, syncs agent-runner source to all group directories, then restarts the service. Use this whenever code changes need to go live.
---

# NanoClaw Compile & Restart

Ensures every layer of the stack is up to date before restarting. Run this after any code change to `src/`, `container/agent-runner/src/`, or group CLAUDE.md files.

## Architecture reminder

There are three distinct layers that must all be updated:

| Layer | Source | Compiled to | Trigger |
|-------|--------|-------------|---------|
| NanoClaw main process | `src/` | `dist/` | `npm run build` + process restart |
| Agent runner (per group) | `container/agent-runner/src/` | `/tmp/dist/` inside container at startup | Sync to `data/sessions/*/agent-runner-src/` + container restart |
| Agent instructions | `groups/{name}/CLAUDE.md` | (none — direct bind mount) | Container restart only |

## Step 1: Build NanoClaw main process

```bash
cd d:/Dev/Tools/nanoclaw && npm run build
```

Check for TypeScript errors. If there are errors, stop and report them — do not proceed.

## Step 2: Sync agent-runner source to all group directories

The container compiles `data/sessions/{group}/agent-runner-src/index.ts` at startup (not the original `container/agent-runner/src/`). Each group has its own copy that must be kept in sync.

```bash
# Find all existing group agent-runner-src directories and sync
for dir in d:/Dev/Tools/nanoclaw/data/sessions/*/agent-runner-src; do
  group=$(basename $(dirname "$dir"))
  cp d:/Dev/Tools/nanoclaw/container/agent-runner/src/index.ts "$dir/index.ts"
  cp d:/Dev/Tools/nanoclaw/container/agent-runner/src/ipc-mcp-stdio.ts "$dir/ipc-mcp-stdio.ts" 2>/dev/null || true
  echo "Synced agent-runner src for group: $group"
done
```

If no directories exist yet (fresh install), that's fine — `container-runner.ts` will create them on first container start using the current source.

## Step 3: Find and kill the running NanoClaw process

```bash
grep "Database initialized" d:/Dev/Tools/nanoclaw/logs/nanoclaw.log | tail -1 | grep -oE '\([0-9]+\)'
```

This prints the PID in parentheses, e.g. `(22092)`. Extract the number and kill it:

```bash
powershell.exe -Command "Stop-Process -Id <PID> -Force"
```

If the PID is not found or the process is already dead, continue.

## Step 3.5: Clean up corrupted sessions

Run this after killing the old process. Clears sessions that would cause an infinite retry loop (e.g. after a force-kill mid-operation).

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

Also scan the recent log for `No message found with message.uuid` errors — these indicate a session whose history is corrupted. If found, clear the affected session:

```bash
grep "No message found with message.uuid" d:/Dev/Tools/nanoclaw/logs/nanoclaw.log 2>/dev/null | tail -5 || true
```

If errors are found, identify the affected group from the surrounding log lines (`Processing messages` → `group: "..."`) and run:

```bash
node -e "
const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database('d:/Dev/Tools/nanoclaw/store/messages.db');
const GROUP = 'GROUP_FOLDER'; // replace with actual group folder
const row = db.prepare('SELECT session_id FROM sessions WHERE group_folder = ?').get(GROUP);
if (row) {
  const sessionDir = 'd:/Dev/Tools/nanoclaw/data/sessions/' + GROUP + '/.claude/projects/-workspace-group/' + row.session_id;
  db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(GROUP);
  try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
  console.log('Cleared session for ' + GROUP + ': ' + row.session_id);
}
db.close();
"
```

## Step 4: Start NanoClaw in background

```bash
cd d:/Dev/Tools/nanoclaw && npm start >> logs/nanoclaw.log 2>&1 &
```

## Step 5: Verify startup

Wait 5 seconds, then check the log:

```bash
sleep 5 && tail -15 d:/Dev/Tools/nanoclaw/logs/nanoclaw.log
```

Look for all of:
- `NanoClaw running (trigger: ...)` — main loop started
- `Discord bot connected` (or other channel connected lines)
- `Credential proxy started` — IPC layer up
- A new PID in `Database initialized` — confirms old process was replaced

If `EADDRINUSE` on port 3001 appears, the old process is still running. Kill all node processes and retry:

```bash
powershell.exe -Command "Get-Process node | Stop-Process -Force"
sleep 2
cd d:/Dev/Tools/nanoclaw && npm start >> logs/nanoclaw.log 2>&1 &
sleep 5 && tail -10 d:/Dev/Tools/nanoclaw/logs/nanoclaw.log
```

## Step 6: Report result

Summarize what was done:
- Whether the build succeeded
- Which group directories were synced (list them)
- The old PID and new PID
- Whether all expected startup lines appeared in the log

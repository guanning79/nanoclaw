#!/bin/bash
set -euo pipefail

NANOCLAW_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$NANOCLAW_DIR/logs"

cd "$NANOCLAW_DIR"

echo "Compiling NanoClaw..."
if ! npm run build; then
    echo ""
    echo "Compilation FAILED. NanoClaw was NOT restarted."
    exit 1
fi
echo "Compilation successful."

# Stop all existing instances by process name
echo "Stopping existing NanoClaw instances..."
pkill -f "node dist/index.js" 2>/dev/null && sleep 2 || true

# Start new instance
mkdir -p "$LOG_DIR"
echo "Starting NanoClaw..."
nohup node dist/index.js >> "$LOG_DIR/nanoclaw.log" 2>&1 &
echo "NanoClaw started (PID $!). Logs: $LOG_DIR/nanoclaw.log"

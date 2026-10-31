#!/data/data/com.termux/files/usr/bin/bash
set -e

# Acquire Termux wake lock so Android kernel CPU does not sleep
termux-wake-lock 2>/dev/null || true

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT/server"

export PORT=5000
export HOST=0.0.0.0
export STORAGE_PATH="$PROJECT_ROOT/server/storage"

echo "Starting PaperPilot Server on http://127.0.0.1:5000..."
exec node dist/index.js

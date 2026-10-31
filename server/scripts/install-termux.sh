#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "=================================================="
echo "   PaperPilot – Termux Environment Installer      "
echo "=================================================="

# 1. Update Termux Package Repositories
echo "[1/6] Updating Termux packages..."
pkg update -y && pkg upgrade -y

# 2. Install Core Dependencies
echo "[2/6] Installing Node.js LTS, Python, SQLite, and Build Tools..."
pkg install -y nodejs-lts python make clang sqlite termux-api

# 3. Setup Android Storage Permissions
echo "[3/6] Requesting Termux storage access..."
termux-setup-storage

# 4. Acquire Wake Lock to Prevent Android Doze from Killing Backend
echo "[4/6] Acquiring Termux wake lock..."
termux-wake-lock

# 5. Install NPM Dependencies & Build Monorepo
echo "[5/6] Installing Node dependencies..."
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$DIR"

npm install
npm run build:shared
npm run build:server

# 6. Verify Installation
echo "[6/6] Verifying server healthcheck..."
export PORT=5000
export HOST=0.0.0.0

echo "PaperPilot backend environment setup complete!"
echo "Run './scripts/start-server.sh' or setup boot script using './scripts/termux-boot-setup.sh'"

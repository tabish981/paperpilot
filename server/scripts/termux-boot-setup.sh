#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "[Termux:Boot Setup] Configuring auto-start on Android boot..."

BOOT_DIR="$HOME/.termux/boot"
mkdir -p "$BOOT_DIR"

SCRIPT_PATH="$BOOT_DIR/start-paperpilot.sh"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cat << 'EOF' > "$SCRIPT_PATH"
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
PROJECT_DIR="__PROJECT_DIR__"
cd "$PROJECT_DIR/server"
export PORT=5000
export HOST=0.0.0.0
node dist/index.js >> "$PROJECT_DIR/server/storage/server.log" 2>&1 &
EOF

sed -i "s|__PROJECT_DIR__|$PROJECT_ROOT|g" "$SCRIPT_PATH"
chmod +x "$SCRIPT_PATH"

echo "Termux:Boot script successfully placed at: $SCRIPT_PATH"
echo "Ensure Termux:Boot app is installed and battery optimization is disabled for Termux!"

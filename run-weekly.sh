#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
NODE_BIN="$(command -v node)"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +%Y-%m-%d-%H%M%S)
LOG_FILE="$LOG_DIR/$TIMESTAMP.log"

{
  echo "=== minpaku-price-bot run: $TIMESTAMP ==="
  "$NODE_BIN" scraper.js
  "$NODE_BIN" report.js
  "$NODE_BIN" generate-dashboard.js
  echo "=== done: $(date +%Y-%m-%d-%H%M%S) ==="
} >> "$LOG_FILE" 2>&1

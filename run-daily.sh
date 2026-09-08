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

# 毎日: 価格取得 + スプレッドシート更新 / 月曜のみ: メール送信
REPORT_ARGS=()
if [ "$(date +%u)" = "1" ]; then
  REPORT_ARGS+=(--email)
fi

{
  echo "=== minpaku-price-bot run: $TIMESTAMP (report args: ${REPORT_ARGS[*]:-none}) ==="
  "$NODE_BIN" scraper.js
  "$NODE_BIN" report.js "${REPORT_ARGS[@]}"
  "$NODE_BIN" generate-dashboard.js
  "$SCRIPT_DIR/deploy-dashboard.sh" || echo "!!! ダッシュボードの公開に失敗しました（他の処理は完了） !!!"
  echo "=== done: $(date +%Y-%m-%d-%H%M%S) ==="
} >> "$LOG_FILE" 2>&1

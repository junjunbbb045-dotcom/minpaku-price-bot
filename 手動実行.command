#!/bin/zsh
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

NODE_BIN="/usr/local/bin/node"

echo "民泊競合価格調査Bot を手動実行します"
echo "（Airbnbへのアクセスを含むため、前回実行から数時間〜翌日空けてから実行してください）"
echo ""
echo "5秒後に開始します。中止する場合はこのウィンドウを閉じてください。"
sleep 5

echo "=== 価格取得を開始: $(date '+%Y-%m-%d %H:%M:%S') ==="
"$NODE_BIN" scraper.js
SCRAPE_STATUS=$?

if [ $SCRAPE_STATUS -ne 0 ]; then
  echo ""
  echo "!!! 価格取得でエラーが発生しました。レポート作成は行いません。 !!!"
  echo "このウィンドウを閉じてください。"
  read -r
  exit 1
fi

echo ""
echo "=== レポート作成・送信を開始: $(date '+%Y-%m-%d %H:%M:%S') ==="
"$NODE_BIN" report.js
REPORT_STATUS=$?

echo ""
if [ $REPORT_STATUS -eq 0 ]; then
  echo "=== 完了しました: $(date '+%Y-%m-%d %H:%M:%S') ==="
  echo "Driveへのアップロードが完了しました。GASトリガーが15分以内にGmailへ送信します。"
else
  echo "!!! レポート作成でエラーが発生しました。 !!!"
fi

echo ""
echo "=== ダッシュボード生成: $(date '+%Y-%m-%d %H:%M:%S') ==="
"$NODE_BIN" generate-dashboard.js
DASH_STATUS=$?

if [ $DASH_STATUS -eq 0 ]; then
  echo "ダッシュボードを開きます..."
  open "$SCRIPT_DIR/dashboard.html"
else
  echo "!!! ダッシュボード生成でエラーが発生しました。 !!!"
fi

echo ""
echo "このウィンドウを閉じて終了してください。"
read -r

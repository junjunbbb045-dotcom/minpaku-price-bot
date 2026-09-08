#!/bin/zsh
# dashboard.html を Cloudflare Pages に公開する。config/cloudflare.env が無ければ何もしない
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

ENV_FILE="$SCRIPT_DIR/config/cloudflare.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "config/cloudflare.env が無いため、ダッシュボードの公開はスキップします"
  exit 0
fi
if [ ! -f "$SCRIPT_DIR/site/index.html" ]; then
  echo "site/index.html が無いため、ダッシュボードの公開はスキップします（先に generate-dashboard.js を実行）"
  exit 0
fi

set -a
source "$ENV_FILE"
set +a

PROJECT="${CLOUDFLARE_PAGES_PROJECT:-minpaku-dashboard}"
echo "Cloudflare Pages に公開: project=$PROJECT"
npx --no-install wrangler pages deploy "$SCRIPT_DIR/site" \
  --project-name "$PROJECT" \
  --branch main \
  --commit-dirty=true

#!/usr/bin/env bash
# 把前端发布到 Cloudflare Workers 免费额度。
# 用法：bash scripts/deploy-web.sh https://你的后端地址
set -euo pipefail

api_base="${1:-}"
if [ -z "$api_base" ]; then
  echo "用法: bash scripts/deploy-web.sh https://your-backend-host" >&2
  echo "后端地址就是隧道或服务器给出的那个 https 地址，不要带结尾斜杠。" >&2
  exit 1
fi

project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"

if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "还没登录 Cloudflare。先运行：npx wrangler login" >&2
  exit 1
fi

# NEXT_PUBLIC_API_BASE 是构建时注入的，必须先构建再发布。
echo "==> 构建前端，后端指向 $api_base"
NEXT_PUBLIC_API_BASE="$api_base" npm run build

echo "==> 发布到 Cloudflare Workers"
npx wrangler deploy

#!/usr/bin/env bash
# 把后端推到 Hugging Face Space。
#
# Space 只跑数据服务，不需要前端。这里只打包 Dockerfile 需要的那几个路径，
# 一来避开 HF 对二进制文件（public/og.png）的限制，二来前端改动不会触发
# Space 重新构建。
#
# 用法：bash scripts/push-space.sh
# 首次会要账号密码：用户名填 HF 用户名，密码填 Write 类型的 Access Token
# （https://huggingface.co/settings/tokens）。
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"

space_url="$(git remote get-url space 2>/dev/null || true)"
if [ -z "$space_url" ]; then
  echo "还没配置 space 远端。先运行：" >&2
  echo "  git remote add space https://huggingface.co/spaces/你的用户名/smashing-a-stock-api" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "有未提交的改动，先 git commit 再推。" >&2
  exit 1
fi

# Dockerfile 只用到这几个路径。
paths=(Dockerfile README.md pyproject.toml uv.lock backend)

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

echo "==> 打包后端文件"
git archive HEAD "${paths[@]}" | tar -x -C "$staging"
find "$staging" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true

# Space 是部署目标不是源码仓库，每次推一个全新的单提交即可。
cd "$staging"
git init -q -b main
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-deploy}" \
    -c user.email="${GIT_AUTHOR_EMAIL:-deploy@local}" \
    commit -q -m "Deploy backend $(git -C "$project_root" rev-parse --short HEAD)"

echo "==> 推送到 $space_url"
git push --force "$space_url" main

echo "==> 完成。去 Space 页面看 Building 进度。"

#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"

export NEXT_PUBLIC_API_BASE="${NEXT_PUBLIC_API_BASE:-http://127.0.0.1:8010}"
export UV_CACHE_DIR="${UV_CACHE_DIR:-$project_root/.cache/uv}"

uv run uvicorn backend.main:app --host 127.0.0.1 --port 8010 --reload --reload-dir backend &
api_pid=$!

cleanup() {
  kill "$api_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

npm run dev

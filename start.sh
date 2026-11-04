#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 Starting Plenrip Audio..."
cd "$PROJECT_DIR"

if [ ! -f "apps/web/.env" ]; then
    echo "⚠️  apps/web/.env not found. Copying from apps/web/.env.example..."
    cp apps/web/.env.example apps/web/.env
    echo "👉 Please update apps/web/.env with your NAS Navidrome URL and credentials."
fi

bun run dev

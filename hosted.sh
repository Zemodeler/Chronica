#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js 22 or newer, then run this script again." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm ci
fi

echo "Freeing ports 3000 through 3010..."
process_ids="$(lsof -tiTCP:3000-3010 -sTCP:LISTEN 2>/dev/null | sort -u || true)"
if [ -n "$process_ids" ]; then
  kill $process_ids
fi

echo "Starting Chronica at http://localhost:3000"
echo "Press Ctrl-C to stop the local server."
npm run dev

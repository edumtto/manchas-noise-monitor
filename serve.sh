#!/usr/bin/env bash
# Serve the app locally so the 3D classroom can load its textures.
# Usage: ./serve.sh [port]   (default port: 8000)
set -e
cd "$(dirname "$0")"
PORT="${1:-8000}"
URL="http://localhost:$PORT"

echo "Serving Manchas at $URL (Ctrl+C to stop)"
if command -v open >/dev/null; then
    (sleep 1 && open "$URL") &
fi
exec python3 -m http.server "$PORT"

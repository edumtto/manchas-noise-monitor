#!/usr/bin/env bash
# Serve the app locally so the 3D classroom can load its model.
# Usage: ./serve.sh [port]   (default port: 8000)
set -e
cd "$(dirname "$0")"
PORT="${1:-8000}"
URL="http://localhost:$PORT"

echo "Serving Manchas at $URL (Ctrl+C to stop)"
if command -v open >/dev/null; then
    (sleep 1 && open "$URL") &
fi
# Like `python3 -m http.server`, but tells the browser to re-check files on every
# load, so edits to the scripts and models show up without a hard refresh
exec python3 - "$PORT" <<'PY'
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

ThreadingHTTPServer(('', int(sys.argv[1])), NoCacheHandler).serve_forever()
PY

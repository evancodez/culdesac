#!/bin/bash
# Double-click to play cul-de-sac in your browser.
cd "$(dirname "$0")"
PORT=5180
( sleep 1; open "http://localhost:$PORT/" ) &
echo "cul-de-sac is running at http://localhost:$PORT/  (close this window to stop)"
if command -v node >/dev/null 2>&1; then
  PORT=$PORT node tools/serve.mjs
else
  python3 -m http.server $PORT --bind 127.0.0.1
fi

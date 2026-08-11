#!/usr/bin/env bash
# A dev server that is definitely new and definitely up.
#
# Every measurement has to be taken on a server that has not hot-reloaded, and
# two runs tonight were lost to starting a probe against a port that was not
# listening yet -- a `page.goto` timeout that looks exactly like a broken probe.
# Sleeping a fixed eight seconds is what caused that; this waits for the port to
# answer instead.
set -euo pipefail

PORT="${MAPS_PORT:-5373}"
API="${LSAT_API_PORT:-5091}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

lsof -ti ":$PORT" -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
sleep 1
cd "$ROOT/frontend"
LSAT_API_PORT="$API" nohup npx vite --port "$PORT" --strictPort >"/tmp/vite-$PORT.log" 2>&1 &
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/map"; then
    echo "server up on $PORT"
    exit 0
  fi
  sleep 1
done
echo "server did not come up on $PORT" >&2
tail -20 "/tmp/vite-$PORT.log" >&2
exit 1

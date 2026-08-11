#!/bin/zsh
# Replicates of the attribution probe: one browser at a time.
# usage: run-attrib.sh <arm> <replicates> [region]
set -u
arm=$1; reps=$2; shift 2
regions="${@:-continent}"
cd "$(dirname "$0")/../.."
for i in $(seq 1 "$reps"); do
  echo "=== $arm r$i $(date +%H:%M:%S) ==="
  MAPS_BASE=${MAPS_BASE:-http://127.0.0.1:5573} MAPS_FRAMES=${MAPS_FRAMES:-3600} \
    MAPS_CHROME=${MAPS_CHROME:-"/Applications/Google Chrome/Google Chrome.app/Contents/MacOS/Google Chrome"} \
    /opt/homebrew/bin/node tools/map-qa/crossing-attrib.mjs "$arm-r$i" ${=regions} 2>&1 | grep -v UNAUTHORIZED
  sleep 1
done
echo "=== $arm done $(date +%H:%M:%S) ==="

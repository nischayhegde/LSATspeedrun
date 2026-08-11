#!/bin/zsh
# Sequential replicates for one arm: one browser at a time, distinct tag per run.
# usage: run-arm.sh <arm> <replicates> <region...>
set -u
arm=$1; reps=$2; shift 2
regions="$@"
cd "$(dirname "$0")/../.."
for i in $(seq 1 "$reps"); do
  echo "=== $arm r$i regions=$regions $(date +%H:%M:%S) ==="
  MAPS_BASE=${MAPS_BASE:-http://127.0.0.1:5573} MAPS_FRAMES=${MAPS_FRAMES:-3600} \
    MAPS_CHROME=${MAPS_CHROME:-"/Applications/Google Chrome/Google Chrome.app/Contents/MacOS/Google Chrome"} \
    /opt/homebrew/bin/node tools/map-qa/collide.mjs "$arm-r$i" ${=regions} > /tmp/arm-$arm-r$i.log 2>&1
  echo "--- exit $? ---"
  tail -25 /tmp/arm-$arm-r$i.log
  pkill -f playwright_chromiumdev_profile 2>/dev/null
  sleep 2
done
echo "=== $arm done $(date +%H:%M:%S) ==="

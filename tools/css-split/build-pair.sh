#!/bin/zsh
# Builds the same working tree twice back to back: once with this workstream's
# stylesheets taken from a given commit, once with them as they are now.
#
#   tools/css-split/build-pair.sh 0d2bbf6 .verify/dist-base .verify/dist-head
#
# Three other workstreams are editing this checkout, the office and map scenes
# among them, so two builds taken minutes apart differ for reasons that have
# nothing to do with the cascade — a baseline built at 03:07 and a treatment
# built at 03:12 disagreed about `.office-floors` and `.uw-holdings`, which are
# somebody else's rules. Restoring only *these* files and building both halves
# in one run is what holds everything else still.
#
# The working copies are saved into .verify/mine before the checkout and put
# back after, so an interrupted run can be recovered from there by hand.
set -e
cd "$(dirname "$0")/../.."
REF=${1:?commit}
BASE=${2:?baseline output directory}
HEAD_OUT=${3:?treatment output directory}

MINE=(frontend/src/styles.css frontend/src/mobile.css frontend/src/performance.css \
      frontend/src/practice-lab.css frontend/src/review-panels.css \
      frontend/src/main.tsx frontend/vite.config.ts)
MINE+=(frontend/src/mobile/*.css(N))
for p in frontend/src/pages/*.tsx; do
  grep -q "'\.\./mobile/" "$p" && MINE+=("$p")
done

mkdir -p .verify/mine
for f in $MINE; do [[ -e $f ]] && cp "$f" ".verify/mine/$(basename $f)"; done

for f in $MINE; do git checkout "$REF" -- "$f" 2>/dev/null || rm -f "$f"; done
(cd frontend && npx vite build --outDir "../$BASE" --emptyOutDir >/dev/null 2>&1)
echo "baseline built from $REF"

for f in $MINE; do
  if [[ -e .verify/mine/$(basename $f) ]]; then cp ".verify/mine/$(basename $f)" "$f"; fi
done
(cd frontend && npx vite build --outDir "../$HEAD_OUT" --emptyOutDir >/dev/null 2>&1)
echo "treatment built from the working tree"

for f in $BASE/assets/index-*.css $HEAD_OUT/assets/index-*.css; do
  printf '%s raw=%s gz=%s\n' "$f" "$(wc -c <"$f")" "$(gzip -9 -c "$f" | wc -c)"
done

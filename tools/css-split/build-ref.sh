#!/bin/zsh
# Builds the app with this workstream's files taken from a given commit and
# everyone else's left as they are, into a named directory.
#
#   tools/css-split/build-ref.sh 503860c .verify/dist-orig
#
# The office and map scenes are being rewritten in the same checkout, so a build
# made an hour ago and a build made now differ for reasons that have nothing to
# do with the stylesheets. Pinning only these files to a ref is what makes the
# two builds comparable.
#
# The working copies are saved into .verify/mine before the checkout and put
# back after, so an interrupted run can be recovered from there by hand.
set -e
cd "$(dirname "$0")/../.."
REF=${1:?commit}
OUT=${2:?output directory}

MINE=(frontend/src/styles.css frontend/src/mobile.css frontend/src/performance.css \
      frontend/src/practice-lab.css frontend/src/review-panels.css \
      frontend/src/main.tsx frontend/vite.config.ts \
      frontend/src/case-flow.tsx frontend/src/markup.tsx frontend/src/pages/cases-page.tsx)
MINE+=(frontend/src/mobile/*.css(N) frontend/src/mobile/*.ts(N))

mkdir -p .verify/mine
for f in $MINE; do [[ -e $f ]] && cp "$f" ".verify/mine/$(basename $f)"; done

for f in $MINE; do git checkout "$REF" -- "$f" 2>/dev/null || rm -f "$f"; done
(cd frontend && npx vite build --outDir "../$OUT" --emptyOutDir >/dev/null)

for f in $MINE; do
  if [[ -e .verify/mine/$(basename $f) ]]; then cp ".verify/mine/$(basename $f)" "$f"; fi
done
for f in $OUT/assets/index-*.css; do
  printf '%s raw=%s gz=%s\n' "$f" "$(wc -c <"$f")" "$(gzip -9 -c "$f" | wc -c)"
done

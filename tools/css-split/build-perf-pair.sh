#!/bin/zsh
# Builds the tree twice back to back: once with the document and the build
# config taken from a given commit, once with them as they are now.
#
#   tools/css-split/build-perf-pair.sh HEAD /tmp/base /tmp/head
#
# Same reason `build-pair.sh` exists, different file list. Three other
# workstreams are editing this checkout — the office scene, the map and the
# strategy screens — so a baseline built at one moment and a treatment built ten
# minutes later disagree about things neither of them changed. Restoring only
# the files this workstream owns and building both halves inside one run is what
# holds the rest of the tree still.
#
# `git show` rather than `git checkout <ref> -- <path>`: the latter stages the
# old file as well as writing it, which leaves a revert of this workstream's own
# commits sitting in the index for the next `git add` to pick up. Other people
# are committing into this repository at the same time.
#
# The working copies go to .verify/perf-mine first, so an interrupted run can be
# put back by hand.
set -e
cd "$(dirname "$0")/../.."

# `~/.zshenv` on this machine puts a Volta shim for Node 18 in front of
# everything, and a script gets that even when the shell that started it does
# not. Vite 7 needs 20.19+, and under 18 it fails on the first inline <style> in
# the document with `crypto.hash is not a function` — which, with the build
# output swallowed, looks exactly like the second half of the pair silently not
# running. Find a new enough Node and put it in front.
if [[ $(node -p 'process.versions.node.split(".")[0]') -lt 20 ]]; then
  for cand in /opt/homebrew/bin/node /usr/local/bin/node $HOME/.nvm/versions/node/*/bin/node(N); do
    [[ -x $cand ]] || continue
    if [[ $($cand -p 'process.versions.node.split(".")[0]') -ge 20 ]]; then
      PATH="${cand:h}:$PATH"
      break
    fi
  done
fi
node -v | read -r nodev
[[ $(node -p 'process.versions.node.split(".")[0]') -ge 20 ]] || { echo "need Node 20.19+, found $nodev"; exit 1; }
echo "building with Node $nodev"
REF=${1:?commit}
BASE=${2:?baseline output directory}
HEAD_OUT=${3:?treatment output directory}
shift 3 2>/dev/null || true
EXTRA=("$@")

# Everything this workstream owns, not just the two files it happened to be
# editing when the script was written. A file left off this list is restored to
# neither side, so it is built into the baseline *and* the treatment and the
# pair silently compares a build against itself — a result of exactly 0 ms that
# looks like a change that did not work rather than like a harness that did not
# run. `main.tsx` starts the current route's preload and `routes.tsx` decides
# which route that is, so both are on the critical path this harness measures.
MINE=(frontend/index.html frontend/vite.config.ts)
MINE+=(frontend/src/main.tsx frontend/src/App.tsx frontend/src/routes.tsx)
MINE+=(frontend/public/fonts/**/*(N.))

restore() {
  for f in $MINE; do
    if [[ -e .verify/perf-mine/${f:t} ]]; then
      mkdir -p "${f:h}"
      cp ".verify/perf-mine/${f:t}" "$f"
    fi
  done
}
trap restore EXIT INT TERM

mkdir -p .verify/perf-mine
for f in $MINE; do [[ -e $f ]] && cp "$f" ".verify/perf-mine/${f:t}"; done

# A build failure has to be loud. Sending it to /dev/null once cost an hour of
# reading a trace to find out that the second half had simply not run.
build() {
  (cd frontend && npx vite build --outDir "$1" --emptyOutDir $EXTRA) >/tmp/lsat-perf-build.log 2>&1 \
    || { echo "build to $1 failed:"; tail -30 /tmp/lsat-perf-build.log; exit 1; }
}

for f in $MINE; do git show "$REF:$f" >"$f" 2>/dev/null || rm -f "$f"; done
build "$BASE"
echo "baseline built from $REF"

restore
build "$HEAD_OUT"
echo "treatment built from the working tree"

for d in "$BASE" "$HEAD_OUT"; do
  html=$(wc -c <"$d/index.html")
  css=$(ls "$d"/assets/index-*.css)
  printf '%s  index.html raw=%s gz=%s   entry css raw=%s gz=%s\n' \
    "$d" "$html" "$(gzip -9 -c "$d/index.html" | wc -c)" "$(wc -c <"$css")" "$(gzip -9 -c "$css" | wc -c)"
done

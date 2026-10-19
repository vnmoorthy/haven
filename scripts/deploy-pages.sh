#!/usr/bin/env bash
# Builds the static "replay" edition of Haven HQ + the motion pitch deck and publishes them to the gh-pages branch.
# Prereq: web/public/replay/bundle.json recorded with scripts/record-replay.mjs against a live server.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${1:-$(git -C "$ROOT" remote get-url origin)}"
cd "$ROOT/web" && npx vite build --mode pages --outDir dist-pages --emptyOutDir
OUT="$ROOT/web/dist-pages"
cp "$OUT/index.html" "$OUT/404.html"
mkdir -p "$OUT/deck" "$OUT/docs"
cp -R "$ROOT/deck/." "$OUT/deck/" 2>/dev/null || true
cp -R "$ROOT/docs/screenshots" "$OUT/docs/" 2>/dev/null || true
cp -R "$ROOT/docs/assets" "$OUT/docs/" 2>/dev/null || true
touch "$OUT/.nojekyll"
TMP="$(mktemp -d)"
cp -R "$OUT/." "$TMP/"
cd "$TMP" && git init -q && git checkout -q -b gh-pages && git add -A && git commit -qm "Deploy Haven replay demo + pitch deck" && git push -qf "$REMOTE" gh-pages
echo "Published to gh-pages ($REMOTE)"

#!/usr/bin/env bash
# Bundle the ThreeScene preview with esbuild and screenshot it headless.
# Usage: [MODES=..] [LOOK=up|down|left|right] scripts/three-preview/shoot-game.sh [outdir]   (default: shots/v2/three)
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(cd ../.. && pwd)
OUT=${1:-$ROOT/shots/v2/three}
TMP=${TMPDIR:-/tmp}/pv2-game
mkdir -p "$TMP" "$OUT"
"$ROOT/node_modules/.bin/esbuild" scripts/three-preview/game.ts --bundle --format=iife --outfile="$TMP/game.js" --log-level=warning
{ echo '<!doctype html><html><head><style>html,body{margin:0;height:100%;background:#07161a}#stage{position:fixed;inset:0}'
  sed -n '/three.js stage overlay/,$p' src/app/globals.css
  echo '</style></head><body><div id="stage"></div><script src="./game.js"></script></body></html>'; } > "$TMP/index.html"
for m in ${MODES:-meeting specimen ghost}; do
  timeout 120 node "$ROOT/shots/v2/three/shoot.mjs" "file://$TMP/index.html?mode=$m${LOOK:+&look=$LOOK}${DBG:+&debug=1}" "$OUT/game-$m${LOOK:+-$LOOK}.png" ${W:-1280} ${H:-720}
done

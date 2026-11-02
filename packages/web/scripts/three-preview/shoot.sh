#!/usr/bin/env bash
# Bundle the three.js crew preview with esbuild and screenshot it headless.
# Usage: scripts/three-preview/shoot.sh [outdir]   (default: shots/v2/three)
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(cd ../.. && pwd)
OUT=${1:-$ROOT/shots/v2/three}
TMP=${TMPDIR:-/tmp}/pv2-three
mkdir -p "$TMP" "$OUT"
"$ROOT/node_modules/.bin/esbuild" scripts/three-preview/turnaround.ts --bundle --format=iife --outfile="$TMP/turnaround.js" --log-level=warning
cat > "$TMP/index.html" <<'H'
<!doctype html><html><body style="margin:0;background:#0c2224"><script src="./turnaround.js"></script></body></html>
H
SHOOT="$ROOT/shots/v2/three/shoot.mjs"
timeout 90 node "$SHOOT" "file://$TMP/index.html?mode=sheet" "$OUT/crew3d-turnaround.png" 1800 840
timeout 90 node "$SHOOT" "file://$TMP/index.html?mode=game" "$OUT/crew3d-game.png" 1280 720

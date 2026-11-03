#!/usr/bin/env bash
# Bundle the outpost preview with esbuild and screenshot it headless.
# Usage: scripts/three-preview/shoot-outpost.sh [outdir]   (default: shots/v2/three)
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(cd ../.. && pwd)
OUT=${1:-$ROOT/shots/v2/three}
TMP=${TMPDIR:-/tmp}/pv2-outpost
mkdir -p "$TMP" "$OUT"
"$ROOT/node_modules/.bin/esbuild" scripts/three-preview/outpost.ts --bundle --format=iife --outfile="$TMP/outpost.js" --log-level=warning
cat > "$TMP/index.html" <<'H'
<!doctype html><html><body style="margin:0;background:#081a1b"><script src="./outpost.js"></script></body></html>
H
SHOOT="$ROOT/shots/v2/three/shoot.mjs"
for m in ${MODES:-overview meeting specimen greenhouse}; do
  timeout 120 node "$SHOOT" "file://$TMP/index.html?mode=$m" "$OUT/outpost-$m.png" 1280 720
done

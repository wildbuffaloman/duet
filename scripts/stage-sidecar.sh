#!/usr/bin/env bash
# Stage the node sidecar payload for the Tauri bundle (M1.5 sidecar v1).
# Layout produced:
#   src-tauri/resources/server/{server.js,package.json,lib/,public/,node_modules/}  (prod deps only)
#   src-tauri/binaries/node-<target-triple>                                    (current node binary)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$ROOT/src-tauri/resources/server"
BIN="$ROOT/src-tauri/binaries"

rm -rf "$STAGE"
mkdir -p "$STAGE" "$BIN"

cp "$ROOT/server.js" "$ROOT/package.json" "$ROOT/package-lock.json" "$STAGE/"
rsync -a "$ROOT/lib/" "$STAGE/lib/"
rsync -a --exclude bench "$ROOT/public/" "$STAGE/public/"

(cd "$STAGE" && npm ci --omit=dev --silent)

TRIPLE="$(rustc -Vv 2>/dev/null | awk '/^host:/{print $2}')"
TRIPLE="${TRIPLE:-aarch64-apple-darwin}"
cp "$(command -v node)" "$BIN/node-$TRIPLE"
chmod +x "$BIN/node-$TRIPLE"

echo "staged sidecar: $(du -sh "$STAGE" | cut -f1) at resources/server, node -> binaries/node-$TRIPLE"

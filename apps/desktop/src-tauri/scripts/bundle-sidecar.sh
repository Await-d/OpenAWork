#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
GATEWAY_DIR="$ROOT/services/agent-gateway"
SIDECARS_DIR="$ROOT/apps/desktop/src-tauri/sidecars/agent-gateway"
BINARIES_DIR="$ROOT/apps/desktop/src-tauri/binaries"
TARGET_TRIPLE="${TAURI_TARGET_TRIPLE:-$(rustc -Vv | grep host | awk '{print $2}')}"

cd "$GATEWAY_DIR"
pnpm build

rm -rf "$SIDECARS_DIR"
mkdir -p "$SIDECARS_DIR"
cp -r "$GATEWAY_DIR/dist" "$SIDECARS_DIR/dist"
cp -RL "$GATEWAY_DIR/node_modules" "$SIDECARS_DIR/node_modules"

echo "Gateway assets staged: $SIDECARS_DIR"

mkdir -p "$BINARIES_DIR"
NODE_BIN="$(which node)"
cp "$NODE_BIN" "$BINARIES_DIR/node-$TARGET_TRIPLE"

echo "Node sidecar staged: $BINARIES_DIR/node-$TARGET_TRIPLE"

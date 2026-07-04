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

# 清理 target/<profile>/sidecars/agent-gateway 下的陈旧副本——
# Tauri build script 在 dev 模式下不会自动同步 sidecar 内容变化
# (tauri-apps/tauri#14992)，旧副本会让 node 启动时缺包崩溃。
TARGET_DIR="$ROOT/apps/desktop/src-tauri/target"
for profile in debug release; do
  rm -rf "$TARGET_DIR/$profile/sidecars/agent-gateway"
done
echo "Stale sidecar copies under target/{debug,release}/sidecars/agent-gateway cleared"

# 写入 bundle stamp 触发 cargo 重新运行 build.rs。
# build.rs 通过 cargo:rerun-if-changed 监听 sidecars/.bundle-stamp 和
# binaries/.bundle-stamp。stamp 必须放在 sidecars/ 根（而非 agent-gateway 子目录），
# 否则会被上面的 rm -rf 流程误删。
SIDECARS_ROOT="$ROOT/apps/desktop/src-tauri/sidecars"
STAMP_CONTENT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p "$SIDECARS_ROOT" "$BINARIES_DIR"
printf '%s\n' "$STAMP_CONTENT" > "$SIDECARS_ROOT/.bundle-stamp"
printf '%s\n' "$STAMP_CONTENT" > "$BINARIES_DIR/.bundle-stamp"
echo "Bundle stamps written; cargo will rerun tauri build script on next build"

#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  exit 0
fi

if ! command -v pkg-config >/dev/null 2>&1; then
  cat <<'EOF'
缺少 Linux 桌面打包依赖：pkg-config

请先安装以下依赖后再执行桌面打包：
  sudo apt-get update
  sudo apt-get install -y pkg-config libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
EOF
  exit 1
fi

missing=()

for pkg in glib-2.0 webkit2gtk-4.1 appindicator3-0.1 librsvg-2.0; do
  if ! pkg-config --exists "$pkg"; then
    missing+=("$pkg")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  printf '缺少 Linux 桌面打包依赖：%s\n' "${missing[*]}"
  cat <<'EOF'

请先安装以下依赖后再执行桌面打包：
  sudo apt-get update
  sudo apt-get install -y pkg-config libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
EOF
  exit 1
fi

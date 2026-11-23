#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/native-gateway/common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
用法：scripts/native-gateway/install.sh [--skip-build] [--skip-browser-install]

创建 Linux systemd 用户服务并立即启动，不需要 sudo。
已有 gateway.env 保持不变；默认配置位于 ~/.config/openawork-gateway/gateway.env。
默认始终构建前端并发布到 OPENAWORK_WEB_DIST，旧前端保留备份。
--skip-build            使用已部署产物，不构建或发布前端
--skip-browser-install  跳过下载，仍真实启动 Chromium 验证
EOF
}

skip_build=false
skip_browser=false
for argument in "$@"; do
  case "$argument" in
    --skip-build) skip_build=true ;;
    --skip-browser-install) skip_browser=true ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; native_die "未知参数：${argument}" ;;
  esac
done

native_check_platform
native_lock
if [ ! -e "$NATIVE_GATEWAY_ENV_FILE" ]; then
  mkdir -p -- "$(dirname -- "$NATIVE_GATEWAY_ENV_FILE")"
  env_tmp="$(mktemp "${NATIVE_GATEWAY_ENV_FILE}.XXXXXX")"
  chmod 600 -- "$env_tmp"
  {
    printf 'NODE_ENV=production\nGATEWAY_HOST=0.0.0.0\nGATEWAY_PORT=8000\n'
    printf 'JWT_SECRET=%s\n' "$(node --input-type=module -e 'import { randomBytes } from "node:crypto"; console.log(randomBytes(48).toString("hex"));')"
    printf 'OPENAWORK_DATA_DIR="%s"\n' "${XDG_DATA_HOME:-$HOME/.local/share}/OpenAWork/native-gateway/data"
    printf 'PLAYWRIGHT_BROWSERS_PATH="%s"\n' "${XDG_DATA_HOME:-$HOME/.local/share}/OpenAWork/native-gateway/browsers"
    printf 'OPENAWORK_BROWSER_LIVE=1\n'
  } >"$env_tmp"
  mv -- "$env_tmp" "$NATIVE_GATEWAY_ENV_FILE"
  native_log "已生成配置：${NATIVE_GATEWAY_ENV_FILE}"
fi
native_load_env
trap native_cleanup_frontend EXIT
if [ "$skip_build" = true ]; then
  native_check_build
else
  native_build
  native_check_build "${NATIVE_GATEWAY_REPO}/apps/web/dist"
  native_prepare_frontend
fi
native_browser "$skip_browser"
native_check_port

unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p -- "$unit_dir"
unit_file="${unit_dir}/${NATIVE_GATEWAY_SERVICE_NAME}"
native_write_unit "$unit_file"
systemd-analyze --user verify "$unit_file"
systemctl --user daemon-reload
systemctl --user enable "$NATIVE_GATEWAY_SERVICE_NAME"
native_publish_frontend
systemctl --user restart "$NATIVE_GATEWAY_SERVICE_NAME"
native_health
native_linger
native_log "安装完成；日志：${SCRIPT_DIR}/gateway.sh logs"

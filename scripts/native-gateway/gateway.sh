#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/native-gateway/common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
用法：scripts/native-gateway/gateway.sh start|stop|restart|status|logs|health
使用当前用户的 openawork-gateway.service；logs 持续跟踪最近 100 行日志。
可通过 NATIVE_GATEWAY_ENV_FILE 与 NATIVE_GATEWAY_SERVICE_NAME 指定其他实例。
EOF
}

command="${1:-status}"
case "$command" in -h | --help) usage; exit 0 ;; esac
native_require systemctl
case "$command" in
  start | restart)
    native_load_env
    systemctl --user "$command" "$NATIVE_GATEWAY_SERVICE_NAME"
    native_health
    ;;
  stop) systemctl --user stop "$NATIVE_GATEWAY_SERVICE_NAME" ;;
  status) systemctl --user status --no-pager "$NATIVE_GATEWAY_SERVICE_NAME" ;;
  logs) journalctl --user --unit "$NATIVE_GATEWAY_SERVICE_NAME" -n 100 -f ;;
  health) native_load_env; native_health ;;
  *) usage >&2; native_die "未知命令：${command}" ;;
esac

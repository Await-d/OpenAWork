#!/usr/bin/env bash
# 本机部署脚本的公共函数；环境文件属于部署用户，按 shell 赋值格式保存。

NATIVE_GATEWAY_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_GATEWAY_REPO="$(cd -- "${NATIVE_GATEWAY_SCRIPT_DIR}/../.." && pwd)"
NATIVE_GATEWAY_CONFIG_DIR="${NATIVE_GATEWAY_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/openawork-gateway}"
NATIVE_GATEWAY_ENV_FILE="${NATIVE_GATEWAY_ENV_FILE:-${NATIVE_GATEWAY_CONFIG_DIR}/gateway.env}"
NATIVE_GATEWAY_SERVICE_NAME="${NATIVE_GATEWAY_SERVICE_NAME:-openawork-gateway.service}"

native_log() { printf '[本机网关] %s\n' "$*"; }
native_die() { printf '[本机网关] 错误：%s\n' "$*" >&2; exit 1; }

native_require() {
  local name
  for name in "$@"; do
    command -v "$name" >/dev/null 2>&1 || native_die "缺少命令：${name}"
  done
}

native_check_platform() {
  [ "$(uname -s)" = Linux ] || native_die '当前脚本仅支持 Linux systemd 用户服务。'
  [ "$(id -u)" != 0 ] || native_die '请使用普通用户执行，不要使用 sudo 或 root。'
  native_require node bun systemctl curl flock
  systemctl --user show-environment >/dev/null 2>&1 ||
    native_die '无法连接 systemd 用户管理器；请先登录该用户的正常会话。'
  node --input-type=module -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 13)) process.exit(1);
  ' || native_die 'Node.js 版本必须至少为 22.13。'
}

native_lock() {
  mkdir -p -- "$NATIVE_GATEWAY_CONFIG_DIR"
  exec 9>"${NATIVE_GATEWAY_CONFIG_DIR}/operation.lock"
  flock -n 9 || native_die '另一个安装或更新操作正在执行。'
}

native_load_env() {
  [ -f "$NATIVE_GATEWAY_ENV_FILE" ] || native_die "配置不存在：${NATIVE_GATEWAY_ENV_FILE}"
  set -a
  # shellcheck disable=SC1090
  source "$NATIVE_GATEWAY_ENV_FILE"
  set +a
  local jwt_secret="${JWT_SECRET:-}"
  [ "${#jwt_secret}" -ge 32 ] || native_die 'JWT_SECRET 必须至少为 32 字符。'
  [ -n "${OPENAWORK_DATA_DIR:-}" ] || native_die '请显式设置 OPENAWORK_DATA_DIR。'
  [[ "$OPENAWORK_DATA_DIR" = /* ]] || native_die 'OPENAWORK_DATA_DIR 必须是绝对路径。'
  chmod 600 -- "$NATIVE_GATEWAY_ENV_FILE"
  mkdir -p -- "$OPENAWORK_DATA_DIR"
}

native_build() {
  node "${NATIVE_GATEWAY_SCRIPT_DIR}/frontend.mjs" validate \
    "${NATIVE_GATEWAY_REPO}/apps/web/dist" "${OPENAWORK_WEB_DIST:-${NATIVE_GATEWAY_REPO}/apps/web/dist}"
  native_log '安装锁定依赖并构建当前工作区（不执行 git pull）。'
  (
    cd -- "$NATIVE_GATEWAY_REPO" || exit 1
    bun install --frozen-lockfile &&
      bun run --filter './packages/*' build &&
      bun run --filter @openAwork/agent-gateway build &&
      cp -- services/agent-gateway/src/tools/bash.txt services/agent-gateway/dist/tools/bash.txt &&
      bun run --filter @openAwork/web build
  )
}

native_prepare_frontend() {
  NATIVE_GATEWAY_FRONTEND_STAGE="$(node "${NATIVE_GATEWAY_SCRIPT_DIR}/frontend.mjs" prepare \
    "${NATIVE_GATEWAY_REPO}/apps/web/dist" "${OPENAWORK_WEB_DIST:-${NATIVE_GATEWAY_REPO}/apps/web/dist}")"
}

native_cleanup_frontend() {
  if [ -n "${NATIVE_GATEWAY_FRONTEND_STAGE:-}" ]; then
    rm -rf -- "$NATIVE_GATEWAY_FRONTEND_STAGE"
  fi
}

native_publish_frontend() {
  [ -n "${NATIVE_GATEWAY_FRONTEND_STAGE:-}" ] || return 0
  node "${NATIVE_GATEWAY_SCRIPT_DIR}/frontend.mjs" publish \
    "${NATIVE_GATEWAY_REPO}/apps/web/dist" "$OPENAWORK_WEB_DIST" "$NATIVE_GATEWAY_FRONTEND_STAGE"
  NATIVE_GATEWAY_FRONTEND_STAGE=''
}

native_check_build() {
  local web_dist="${1:-${OPENAWORK_WEB_DIST:-${NATIVE_GATEWAY_REPO}/apps/web/dist}}"
  [ -f "${NATIVE_GATEWAY_REPO}/services/agent-gateway/dist/index.js" ] ||
    native_die '网关构建产物不存在，请先构建或移除 --skip-build。'
  [ -f "${web_dist}/index.html" ] ||
    native_die "前端产物不存在：${web_dist}/index.html"
}

native_check_port() {
  if systemctl --user is-active --quiet "$NATIVE_GATEWAY_SERVICE_NAME"; then
    return 0
  fi
  node --input-type=module <<'JS'
import { createServer } from 'node:net';
const port = Number(process.env.GATEWAY_PORT || 8000);
const server = createServer();
server.once('error', (error) => {
  console.error(`端口 ${port} 不可用：${error.code}；请先停止占用端口的 Docker 或其他实例。`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => server.close());
JS
}

native_browser() {
  local skip_install="${1:-false}" cli
  [ "${OPENAWORK_BROWSER_LIVE:-0}" = 1 ] || return 0
  cli="${NATIVE_GATEWAY_REPO}/packages/browser-automation/node_modules/playwright/cli.js"
  [ -f "$cli" ] || native_die 'Playwright 尚未安装，请执行 bun install。'
  if [ "$skip_install" != true ]; then
    node "$cli" install chromium
  fi
  native_log '实际启动 Chromium 验证浏览器依赖。'
  node --input-type=module - "${cli%/cli.js}/index.mjs" <<'JS'
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.OPENAWORK_BROWSER_PATH ? { executablePath: process.env.OPENAWORK_BROWSER_PATH } : {}),
});
try {
  const page = await browser.newPage();
  await page.goto('data:text/html,<title>OpenAWork</title>');
  if ((await page.title()) !== 'OpenAWork') throw new Error('浏览器页面验证失败');
  console.log(`Chromium ${browser.version()} 启动验证通过。`);
} finally {
  await browser.close();
}
JS
}

native_health() {
  local attempt url="http://127.0.0.1:${GATEWAY_PORT:-8000}/health"
  for ((attempt = 0; attempt < 60; attempt++)); do
    if systemctl --user is-active --quiet "$NATIVE_GATEWAY_SERVICE_NAME" &&
      curl --fail --silent --max-time 2 "$url" >/dev/null; then
      native_log "健康检查通过：${url}"
      return 0
    fi
    sleep 1
  done
  printf '[本机网关] 健康检查失败：%s；查看 gateway.sh logs\n' "$url" >&2
  return 1
}

native_linger() {
  if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)" != yes ]; then
    loginctl enable-linger "$(id -un)" --no-ask-password 2>/dev/null || true
  fi
  if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)" != yes ]; then
    native_log "提示：用户 linger 尚未启用，退出登录或重启后可能无法自动运行；管理员可执行 loginctl enable-linger $(id -un)。"
  fi
}

# WorkingDirectory/EnvironmentFile 的值在 systemd 249 中整体作为路径读取，不能加引号。
# ExecStart/Environment 则使用词法解析，需要引号保护路径空格。
native_write_unit() {
  local unit_file="$1" node_path bun_path
  node_path="$(readlink -f -- "$(command -v node)")"
  bun_path="$(readlink -f -- "$(command -v bun)")"
  native_unit_quote() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    value="${value//%/%%}"
    printf '"%s"' "$value"
  }
  {
    printf '[Unit]\nDescription=OpenAWork 本机网关\nAfter=network.target\n\n'
    printf '[Service]\nType=simple\nWorkingDirectory=%s\n' "${NATIVE_GATEWAY_REPO//%/%%}"
    printf 'EnvironmentFile=%s\n' "${NATIVE_GATEWAY_ENV_FILE//%/%%}"
    printf 'Environment=%s\n' "$(native_unit_quote "PATH=${node_path%/*}:${bun_path%/*}:${PATH}")"
    printf 'ExecStart=%s %s\n' "$(native_unit_quote "$node_path")" "$(native_unit_quote "${NATIVE_GATEWAY_REPO}/services/agent-gateway/dist/index.js")"
    printf 'Restart=on-failure\nRestartSec=3\nTimeoutStopSec=60\nKillMode=mixed\nUMask=0077\n\n'
    printf '[Install]\nWantedBy=default.target\n'
  } >"$unit_file"
}

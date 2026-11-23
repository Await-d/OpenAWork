#!/usr/bin/env bash
# 使用实际 systemd 解析器验证安装脚本生成的 unit，不启动任何服务。
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/native-gateway/common.sh
source "${SCRIPT_DIR}/common.sh"
native_require systemd-analyze node bun
native_test_dir="$(mktemp -d /tmp/openawork-unit-test.XXXXXX)"
trap 'rm -rf -- "$native_test_dir"' EXIT
for variation in plain '含空格 project' 'percent%project'; do
  NATIVE_GATEWAY_REPO="${native_test_dir}/${variation}"
  NATIVE_GATEWAY_ENV_FILE="${NATIVE_GATEWAY_REPO}/gateway env"
  mkdir -p -- "$NATIVE_GATEWAY_REPO"
  printf 'JWT_SECRET=test-secret\n' >"$NATIVE_GATEWAY_ENV_FILE"
  native_write_unit "${native_test_dir}/probe.service"
  # verify 对部分未知指令仅打印 warning，因此同时要求 stderr 为空。
  systemd-analyze --user verify "${native_test_dir}/probe.service" >"${native_test_dir}/verify.log" 2>&1
  if [ -s "${native_test_dir}/verify.log" ]; then
    cat "${native_test_dir}/verify.log" >&2
    exit 1
  fi
  printf 'systemd unit 解析通过：%s\n' "$variation"
done

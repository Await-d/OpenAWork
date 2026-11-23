#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/native-gateway/common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'EOF'
用法：scripts/native-gateway/update.sh [--skip-build] [--skip-browser-install]

构建当前 checkout，验证 Chromium，然后短暂停止服务、备份 SQLite 并重新启动。
默认始终构建前端；外部 OPENAWORK_WEB_DIST 在冷备份后发布，旧前端保留备份。
--skip-build 不构建或发布前端，使用当前已部署产物。
不自动拉取 Git，不覆盖配置；原先停止的服务保持停止。
备份默认在 ~/.local/state/OpenAWork/native-backups，可通过 NATIVE_GATEWAY_BACKUP_DIR 覆盖。
每类备份保留最新 NATIVE_GATEWAY_BACKUP_KEEP 份（默认 1），更早的自动清理；
空间不足时继续按最旧优先清理。旧前端只保留最新一份 .previous。
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

# 备份保留策略在 trap 里也要用，故提前声明，避免 set -u 下引用未定义变量。
backup_root=''
backup_keep=''
backup_partial=''

# 目录名内嵌 YYYYMMDD-HHMMSS，按名称倒序即最新在前，不依赖 mtime。
# 名称不符合约定的一律跳过，避免误删手工放入的目录。
native_backup_dirs() {
  local root="$1" prefix="$2"
  find "$root" -mindepth 1 -maxdepth 1 -type d -name "${prefix}-*" -printf '%f\n' 2>/dev/null |
    grep -E "^${prefix}-[0-9]{8}-[0-9]{6}-[A-Za-z0-9]+$" |
    sort -r || true
}

# 用 command -p 调系统 rm：跳过 shell 函数并使用默认 PATH，
# 避免 rm 被包装成「移入回收站」时备份看似清理、实则未释放空间。
native_remove_backup() {
  command -p rm -rf --one-file-system -- "$1"
}

# 只保留每类（update / docker-migration）最新的若干份备份。
# 单片全量数据库快照可达数 GB，无上限时 native-backups 会随每次更新持续堆积。
native_prune_backups() {
  local root="$1" keep="$2" prefix name index
  local -a names=()
  for prefix in update docker-migration; do
    mapfile -t names < <(native_backup_dirs "$root" "$prefix")
    index=0
    for name in "${names[@]}"; do
      index=$((index + 1))
      if ((index > keep)); then
        native_remove_backup "${root:?}/${name}"
        native_log "清理旧备份：${root}/${name}"
      fi
    done
  done
  # 被 SIGKILL 打断的备份会留下 .partial-* 半成品：它不匹配正式命名，
  # 上面的规则永远清不到，必须单独回收，否则每次失败都白占一份整库空间。
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    native_remove_backup "${root:?}/${name}"
    native_log "清理未完成的备份：${root}/${name}"
  done < <(find "$root" -mindepth 1 -maxdepth 1 -type d -name '.partial-*' -printf '%f\n' 2>/dev/null || true)
}

native_free_kb() {
  df -Pk -- "$1" | awk 'NR == 2 { print $4 }'
}

# 备份是整库快照，单片可达数 GB。保留策略清完仍不够时，按「最旧优先」继续删，
# 避免历史备份占满磁盘后本次更新直接失败；删光仍不足则明确报错，绝不写半截备份。
native_reserve_backup_space() {
  local root="$1" required_kb="$2" margin_kb=$((512 * 1024))
  local needed=$((required_kb + margin_kb)) free prefix oldest
  free="$(native_free_kb "$root")"
  ((free >= needed)) && return 0
  native_log "备份空间不足：需要 $((needed / 1024)) MiB，可用 $((free / 1024)) MiB；按最旧优先清理历史备份。"
  # update-* 是可回滚点，docker-migration-* 是迁移快照，先让位给前者。
  for prefix in update docker-migration; do
    while ((free < needed)); do
      oldest="$(native_backup_dirs "$root" "$prefix" | tail -n 1)"
      [ -n "$oldest" ] || break
      native_remove_backup "${root:?}/${oldest}"
      native_log "空间不足，清理旧备份：${root}/${oldest}"
      free="$(native_free_kb "$root")"
    done
    ((free >= needed)) && return 0
  done
  native_log "可用空间仍不足：需要 $((needed / 1024)) MiB，可用 $((free / 1024)) MiB。"
  return 1
}

native_check_platform
native_lock
native_load_env
systemctl --user cat "$NATIVE_GATEWAY_SERVICE_NAME" >/dev/null 2>&1 ||
  native_die '服务尚未安装，请先执行 install.sh。'
was_running=false
if systemctl --user is-active --quiet "$NATIVE_GATEWAY_SERVICE_NAME"; then
  was_running=true
fi
service_stopped=false
recover_service() {
  local exit_status=$?
  trap - EXIT
  if [ -n "$backup_partial" ] && [ -d "$backup_partial" ]; then
    native_remove_backup "$backup_partial" || true
    backup_partial=''
  fi
  native_cleanup_frontend || printf '[本机网关] 暂存清理失败，请检查暂存目录。\n' >&2
  # 失败路径同样要收敛备份数量：否则反复失败的更新会把磁盘堆满。
  if [ -n "$backup_root" ] && [ -n "$backup_keep" ]; then
    native_prune_backups "$backup_root" "$backup_keep" ||
      printf '[本机网关] 旧备份清理失败，可稍后手工处理：%s\n' "$backup_root" >&2
  fi
  if [ "$exit_status" -ne 0 ] && [ "$service_stopped" = true ] && [ "$was_running" = true ]; then
    printf '[本机网关] 更新失败，尝试恢复服务；构建产物不会自动回滚。\n' >&2
    systemctl --user start "$NATIVE_GATEWAY_SERVICE_NAME" ||
      printf '[本机网关] 恢复启动失败，请查看 gateway.sh logs。\n' >&2
  fi
  exit "$exit_status"
}
trap recover_service EXIT

if [ "$skip_build" = true ]; then
  native_check_build
else
  native_build
  native_check_build "${NATIVE_GATEWAY_REPO}/apps/web/dist"
  native_prepare_frontend
fi
native_browser "$skip_browser"

backup_root="${NATIVE_GATEWAY_BACKUP_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/OpenAWork/native-backups}"
backup_keep="${NATIVE_GATEWAY_BACKUP_KEEP:-1}"
if [[ ! "$backup_keep" =~ ^[1-9][0-9]*$ ]]; then
  native_log "NATIVE_GATEWAY_BACKUP_KEEP 必须是正整数，已按 1 处理：${backup_keep}"
  backup_keep=1
fi
mkdir -p -- "$backup_root"

# 先按保留策略清理历史（含旧前端），再创建本次备份：
# 否则「新建 + 旧备份」会在停服窗口里叠出双倍占用，磁盘紧张时直接写失败。
native_prune_backups "$backup_root" "$backup_keep" ||
  native_log "旧备份清理失败，可稍后手工处理：${backup_root}"
node "${SCRIPT_DIR}/frontend.mjs" prune \
  "${NATIVE_GATEWAY_REPO}/apps/web/dist" "${OPENAWORK_WEB_DIST:-${NATIVE_GATEWAY_REPO}/apps/web/dist}" ||
  native_log '前端旧版本清理失败，可稍后手工处理。'

systemctl --user stop "$NATIVE_GATEWAY_SERVICE_NAME"
service_stopped=true
database_path="${OPENAWORK_DATABASE_PATH:-${DATABASE_URL:-${OPENAWORK_DATA_DIR}/openAwork.db}}"
required_kb=0
if [ "$database_path" != ':memory:' ]; then
  case "$database_path" in /*) ;; *) database_path="${NATIVE_GATEWAY_REPO}/${database_path}" ;; esac
  for suffix in '' '-wal' '-shm'; do
    if [ -f "${database_path}${suffix}" ]; then
      required_kb=$((required_kb + $(stat -c %s -- "${database_path}${suffix}") / 1024 + 1))
    fi
  done
fi
native_reserve_backup_space "$backup_root" "$required_kb" ||
  native_die "备份空间不足，已放弃本次更新：${backup_root}"

# 半成品写在 .partial-* 前缀下：既不会被「保留最新 N 份」误认成有效备份，
# 也能在 trap 与下次运行时被回收。全部复制成功后才 rename 成正式名称。
backup_stamp="$(date +%Y%m%d-%H%M%S)"
backup_partial="$(mktemp -d "${backup_root}/.partial-${backup_stamp}-XXXXXX")"
chmod 700 -- "$backup_partial"
cp -- "$NATIVE_GATEWAY_ENV_FILE" "${backup_partial}/gateway.env"
if [ "$database_path" != ':memory:' ]; then
  for suffix in '' '-wal' '-shm'; do
    if [ -f "${database_path}${suffix}" ]; then
      cp --reflink=auto -- "${database_path}${suffix}" "${backup_partial}/openAwork.db${suffix}"
    fi
  done
fi
backup_dir="${backup_root}/update-${backup_stamp}-${backup_partial##*-}"
mv -- "$backup_partial" "$backup_dir"
backup_partial=''
native_log "更新前备份：${backup_dir}（数据库及配置；附件仍保留在数据目录）"
native_publish_frontend
if [ "$was_running" = true ]; then
  systemctl --user start "$NATIVE_GATEWAY_SERVICE_NAME"
  native_health
else
  native_log '原服务未运行，更新后保持停止；使用 gateway.sh start 启动。'
fi
service_stopped=false
native_log '更新完成。'
# 放在服务恢复之后且失败不阻断：只影响历史备份，与本次发布结果无关。
native_prune_backups "$backup_root" "$backup_keep" ||
  native_log "旧备份清理失败，可稍后手工处理：${backup_root}"

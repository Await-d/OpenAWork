#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ]; then
  printf '用法：%s <回滚目标文件>\n' "$0" >&2
  exit 64
fi
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$script_dir/BASELINE_FILE" "$1"
printf 'ROLLED_BACK: %s\n' "$1"

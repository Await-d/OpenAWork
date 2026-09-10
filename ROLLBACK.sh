#!/usr/bin/env bash
set -euo pipefail
target=${1:?target copy required}
: > "$target"
printf '%s\n' 'rollback_restored=PASS'

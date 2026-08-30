#!/usr/bin/env bash
set -euo pipefail

target="${1:?target file is required}"
original="${2:-${target}.original}"
cp "$original" "$target"

#!/usr/bin/env bash
set -euo pipefail
TARGET=${1:-MODIFIED_FILE}
if [[ "$TARGET" == "MODIFIED_FILE" ]]; then
  cp /tmp/stream-runner.baseline.ts MODIFIED_FILE
else
  cp /tmp/stream-runner.baseline.ts "$TARGET"
fi

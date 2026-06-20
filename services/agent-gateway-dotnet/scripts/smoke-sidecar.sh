#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RID="${1:-linux-x64}"
PORT="${2:-5060}"
ARTIFACT_DIR="$ROOT/artifacts/sidecar/$RID"
EXECUTABLE="$ARTIFACT_DIR/OpenAWork.Gateway.Host"
LOG_FILE="$ARTIFACT_DIR/smoke.log"

mkdir -p "$ARTIFACT_DIR"

if [ ! -x "$EXECUTABLE" ]; then
  "$ROOT/scripts/publish-sidecar.sh" "$RID"
fi

ASPNETCORE_URLS="http://127.0.0.1:$PORT" "$EXECUTABLE" >"$LOG_FILE" 2>&1 &
PID=$!

cleanup() {
  if kill -0 "$PID" >/dev/null 2>&1; then
    kill "$PID" >/dev/null 2>&1 || true
    wait "$PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

sleep 3
curl --fail --silent --show-error "http://127.0.0.1:$PORT/health"
echo
echo "Smoke log: $LOG_FILE"

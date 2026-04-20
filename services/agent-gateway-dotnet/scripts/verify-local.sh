#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOLUTION="$ROOT/OpenAWork.Gateway.DotNet.sln"
CONFIGURATION="${CONFIGURATION:-Debug}"
RID="${1:-linux-x64}"
PORT="${2:-5060}"
LOGGER="${DOTNET_TEST_LOGGER:-console;verbosity=minimal}"

step() {
  printf '\n==> %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

require_command dotnet
require_command curl

step "dotnet info"
dotnet --info

step "restore solution"
dotnet restore "$SOLUTION"

step "build solution ($CONFIGURATION)"
dotnet build "$SOLUTION" -c "$CONFIGURATION" --no-restore

step "run unit tests"
dotnet test "$ROOT/tests/OpenAWork.Gateway.UnitTests/OpenAWork.Gateway.UnitTests.csproj" \
  -c "$CONFIGURATION" \
  --no-build \
  --logger "$LOGGER"

step "run integration tests"
dotnet test "$ROOT/tests/OpenAWork.Gateway.IntegrationTests/OpenAWork.Gateway.IntegrationTests.csproj" \
  -c "$CONFIGURATION" \
  --no-build \
  --logger "$LOGGER"

step "run scenario verification"
dotnet test "$ROOT/tests/OpenAWork.Gateway.ScenarioVerification/OpenAWork.Gateway.ScenarioVerification.csproj" \
  -c "$CONFIGURATION" \
  --no-build \
  --logger "$LOGGER"

step "sidecar smoke ($RID on port $PORT)"
"$ROOT/scripts/smoke-sidecar.sh" "$RID" "$PORT"

printf '\nVerification completed successfully.\n'

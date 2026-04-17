#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RID="${1:-linux-x64}"
OUT_DIR="$ROOT/artifacts/sidecar/$RID"

mkdir -p "$OUT_DIR"

dotnet publish "$ROOT/src/OpenAWork.Gateway.Host/OpenAWork.Gateway.Host.csproj" \
  -c Release \
  -r "$RID" \
  --self-contained true \
  -p:PublishSingleFile=true \
  -p:IncludeNativeLibrariesForSelfExtract=true \
  -o "$OUT_DIR"

echo "Published sidecar to $OUT_DIR"

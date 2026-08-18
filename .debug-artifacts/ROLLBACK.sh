#!/usr/bin/env bash
set -euo pipefail
TARGET="$1"
BACKUP="/home/await/project/OpenAWork/.debug-artifacts/ORIGINAL_FILE"
python3 - "$TARGET" "$BACKUP" <<'PY2'
from pathlib import Path
import sys
target, backup = map(Path, sys.argv[1:])
target.write_text(backup.read_text())
print(f"restored={target}")
PY2

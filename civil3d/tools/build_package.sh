#!/usr/bin/env bash
# Build the distributable ARX-Civil3D-Checker.zip: checker + a copy of the
# shared drawingchecker lib + offline wheels (pywin32 per Python version,
# pypdf). Run from the repo root.
set -euo pipefail
OUT="${1:-ARX-Civil3D-Checker.zip}"
STAGE="$(mktemp -d)/ARX-Civil3D-Checker"
mkdir -p "$STAGE"
cp -r civil3d/checker "$STAGE/checker"
cp "civil3d/ARX Civil3D Checker.bat" civil3d/README.md "$STAGE/"
mkdir -p "$STAGE/lib"
cp -r revit/DrawingChecker.extension/lib/drawingchecker "$STAGE/lib/drawingchecker"
mkdir -p "$STAGE/wheels"
for v in 311 312 313; do
  pip download pywin32 --platform win_amd64 --python-version "$v" \
    --only-binary=:all: --no-deps -q -d "$STAGE/wheels"
done
pip download pypdf --no-deps -q -d "$STAGE/wheels"
find "$STAGE" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true
(cd "$(dirname "$STAGE")" && zip -rq - "$(basename "$STAGE")") > "$OUT"
echo "wrote $OUT"

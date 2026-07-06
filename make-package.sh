#!/bin/bash
# Build the SCORM zip for Canvas upload.
# Usage: ./make-package.sh
set -e
cd "$(dirname "$0")"
OUT="linux-blum-scorm.zip"
rm -f "$OUT"
zip -r "$OUT" imsmanifest.xml index.html css js -x '*.DS_Store'
echo ""
echo "Created $OUT — upload to Canvas via Settings → Import Course Content → SCORM,"
echo "or add it as an Assignment with submission type 'External Tool' if using the SCORM LTI."

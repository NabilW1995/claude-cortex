#!/bin/bash
# Log tool failures for debugging

read -r INPUT

TOOL=$(echo "$INPUT" | sed -n 's/.*"tool"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
ERROR=$(echo "$INPUT" | sed -n 's/.*"error"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)

LOG_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude/logs"
mkdir -p "$LOG_DIR"

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
echo "[$TIMESTAMP] FAILURE $TOOL: $ERROR" >> "$LOG_DIR/failures.log"

# Suggest learning if repeated failure
FAIL_COUNT=$(grep -c "$TOOL" "$LOG_DIR/failures.log" 2>/dev/null || echo 0)
if [ "$FAIL_COUNT" -gt 3 ]; then
  echo "⚠️  $TOOL hat wiederholt Fehler — erwäge ein Learning zu diesem Tool." >&2
fi

exit 0

#!/bin/bash
# Warn about TODO/TBD/FIXME in code being written
# Does NOT block — just warns

read -r INPUT

CONTENT=$(echo "$INPUT" | sed -n 's/.*"content"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
NEW_STRING=$(echo "$INPUT" | sed -n 's/.*"new_string"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)

CHECK_TEXT="${CONTENT}${NEW_STRING}"

if echo "$CHECK_TEXT" | grep -qiE "(TODO|TBD|FIXME|HACK|XXX|PLACEHOLDER)"; then
  echo "⚠️  Code enthält TODO/TBD/FIXME Marker — stelle sicher dass diese vor dem Commit aufgelöst werden." >&2
fi

# Debt-Collector: Track TODO count across project
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
DEBT_FILE="$PROJECT_DIR/.claude/logs/.debt-count"
mkdir -p "$PROJECT_DIR/.claude/logs"

TODO_COUNT=$(grep -riE "(TODO|FIXME|HACK|XXX)" "$PROJECT_DIR/src" "$PROJECT_DIR/scripts" 2>/dev/null | grep -v node_modules | grep -v ".claude/" | wc -l)

if [ -f "$DEBT_FILE" ]; then
  PREV_COUNT=$(cat "$DEBT_FILE" 2>/dev/null || echo 0)
else
  PREV_COUNT=0
fi

echo "$TODO_COUNT" > "$DEBT_FILE"

if [ "$TODO_COUNT" -ge 20 ] && [ "$TODO_COUNT" -gt "$PREV_COUNT" ]; then
  echo "🏦 [Debt-Collector] $TODO_COUNT TODOs/FIXMEs im Projekt (steigend!) — erwäge /debt-map für eine Übersicht." >&2
fi

exit 0

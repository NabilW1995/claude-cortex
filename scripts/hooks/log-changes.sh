#!/bin/bash
# PostToolUse hook — appends every Write|Edit to audit trail.
# Provides a chronological record of all file modifications.
# Uses markdown-style entries and relative paths.
# Uses sed for JSON parsing (no jq dependency).

read -r INPUT

FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"file_path"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
TOOL=$(echo "$INPUT" | sed -n 's/.*"tool_name"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
# Fallback: try "tool" key
if [ -z "$TOOL" ]; then
  TOOL=$(echo "$INPUT" | sed -n 's/.*"tool"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
fi

# Skip if no file path
[ -z "$FILE_PATH" ] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG_DIR="$PROJECT_DIR/.claude/logs"
AUDIT_TRAIL="$LOG_DIR/audit-trail.md"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

mkdir -p "$LOG_DIR"

# Convert to relative path for cleaner logs
RELATIVE_PATH="${FILE_PATH#$PROJECT_DIR/}"

# Write markdown-style entry
echo "- \`$TIMESTAMP\` | $TOOL | \`$RELATIVE_PATH\`" >> "$AUDIT_TRAIL"

exit 0

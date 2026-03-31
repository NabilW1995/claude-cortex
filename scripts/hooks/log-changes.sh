#!/bin/bash
# Log all file changes for audit trail

read -r INPUT

FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"file_path"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
TOOL=$(echo "$INPUT" | sed -n 's/.*"tool"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)

LOG_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude/logs"
mkdir -p "$LOG_DIR"

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
echo "[$TIMESTAMP] $TOOL: $FILE_PATH" >> "$LOG_DIR/changes.log"

exit 0

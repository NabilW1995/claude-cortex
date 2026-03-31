#!/bin/bash
# Auto-backup files before they are modified
# Reads tool input from stdin

read -r INPUT

FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"file_path"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

BACKUP_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude/backups"
mkdir -p "$BACKUP_DIR"

FILENAME=$(basename "$FILE_PATH")
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_PATH="$BACKUP_DIR/${FILENAME}.${TIMESTAMP}.bak"

cp "$FILE_PATH" "$BACKUP_PATH" 2>/dev/null

# Keep only last 10 backups per file
ls -t "$BACKUP_DIR/${FILENAME}".*.bak 2>/dev/null | tail -n +11 | xargs -r rm

exit 0

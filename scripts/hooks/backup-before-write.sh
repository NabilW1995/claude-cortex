#!/bin/bash
# PreToolUse hook — creates timestamped backups before Write|Edit.
# Uses date-based subdirectories and auto-prunes backups older than 7 days.
# Uses sed for JSON parsing (no jq dependency).

read -r INPUT

FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"file_path"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)

# Skip if no file path or file doesn't exist yet
[ -z "$FILE_PATH" ] && exit 0
[ ! -f "$FILE_PATH" ] && exit 0

# Anti-recursion guard: skip files inside .claude/logs/ and .claude/backups/
case "$FILE_PATH" in
  */.claude/logs/*|*/.claude/backups/*|*\\.claude\\logs\\*|*\\.claude\\backups\\*) exit 0 ;;
esac

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
BACKUP_DIR="$PROJECT_DIR/.claude/backups/$(date +%Y-%m-%d)"
mkdir -p "$BACKUP_DIR"

# Create backup with timestamp suffix
BASENAME=$(basename "$FILE_PATH")
TIMESTAMP=$(date +"%H%M%S")
cp "$FILE_PATH" "$BACKUP_DIR/${BASENAME}.${TIMESTAMP}.bak" 2>/dev/null

# Prune backups older than 7 days (remove entire date directories)
find "$PROJECT_DIR/.claude/backups" -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \; 2>/dev/null

exit 0

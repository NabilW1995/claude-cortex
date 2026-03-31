#!/bin/bash
# Save state before context compaction
# Ensures Claude doesn't lose track of what it was doing

STATE_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude/logs"
mkdir -p "$STATE_DIR"

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Save compaction marker
echo "[$TIMESTAMP] Pre-compact: saving state" >> "$STATE_DIR/compaction.log"

# Copy memory.md as pre-compact backup
if [ -f "${CLAUDE_PROJECT_DIR:-.}/.claude/memory.md" ]; then
  cp "${CLAUDE_PROJECT_DIR:-.}/.claude/memory.md" "$STATE_DIR/memory-pre-compact.md"
fi

exit 0

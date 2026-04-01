#!/bin/bash
# PreCompact hook — saves state before auto-compaction.
# Writes a .compaction-occurred marker file with timestamp
# for post-compact-resume.sh to detect and act on.
# Also backs up memory.md for safety.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG_DIR="$PROJECT_DIR/.claude/logs"
INCIDENT_LOG="$LOG_DIR/incident-log.md"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

mkdir -p "$LOG_DIR"

# Write compaction marker with timestamp (post-compact-resume.sh reads this)
echo "$TIMESTAMP" > "$LOG_DIR/.compaction-occurred"

# Backup memory.md as pre-compact safety copy
if [ -f "$PROJECT_DIR/.claude/memory.md" ]; then
  cp "$PROJECT_DIR/.claude/memory.md" "$LOG_DIR/memory-pre-compact.md" 2>/dev/null
fi

# Log the compaction event
echo "- \`$TIMESTAMP\` | COMPACTION | INFO | Auto-compaction triggered — state saved, marker written" >> "$INCIDENT_LOG"

exit 0

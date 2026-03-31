#!/bin/bash
# Restore context after compaction

STATE_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude/logs"

if [ -f "$STATE_DIR/memory-pre-compact.md" ]; then
  echo "[Learning-DB] 🔄 Kontext nach Komprimierung wiederhergestellt" >&2
  echo "Lies .claude/memory.md für den aktuellen Stand." >&2
fi

exit 0

#!/bin/bash
# SessionStart(compact) hook — restores context after auto-compaction.
# Reads the marker left by pre-compact.sh, resets counters,
# and injects resumption instructions for Claude.
#
# Replaces the old post-compact.sh with proper handoff support.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG_DIR="$PROJECT_DIR/.claude/logs"
MARKER="$LOG_DIR/.compaction-occurred"

# Only run if compaction actually occurred
if [ ! -f "$MARKER" ]; then
  exit 0
fi

# Reset session counters
rm -f "$LOG_DIR/.tool-call-count" "$LOG_DIR/.quality-gate-active" 2>/dev/null

# Read compaction timestamp
COMPACT_TIME=$(cat "$MARKER" 2>/dev/null || echo "unknown")

# Clean up marker
rm -f "$MARKER"

# Output resumption context for Claude
echo "POST-COMPACTION RESUME: Kontext wurde komprimiert um $COMPACT_TIME. Lies .claude/memory.md und die letzte Daily Note um den Stand zu laden. Mach weiter wo du warst — frag den User NICHT was zu tun ist."

exit 0

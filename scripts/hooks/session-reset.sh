#!/bin/bash
# SessionStart(user) hook — resets stale state on fresh session start.
# Cleans up gate files, validates agent definitions, checks permissions,
# ensures required directories exist, and prunes oversized logs.
#
# Adapted from Claudify's session-reset.sh for sed-based (no jq) environments.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG_DIR="$PROJECT_DIR/.claude/logs"
AGENTS_DIR="$PROJECT_DIR/.claude/agents"
HOOKS_DIR="$PROJECT_DIR/scripts/hooks"
INCIDENT_LOG="$LOG_DIR/incident-log.md"

mkdir -p "$LOG_DIR"

# ═══════════════════════════════════════════════════════
# 1. Reset stale gate files (prevents cross-session deadlocks)
# ═══════════════════════════════════════════════════════
rm -f "$LOG_DIR/.quality-gate-active" \
      "$LOG_DIR/.tool-call-count" \
      "$LOG_DIR/.compaction-occurred" 2>/dev/null

# Clean up stale session-blocks files (older than 2 hours / 120 minutes)
find "$LOG_DIR" -name ".session-blocks-*" -mmin +120 -delete 2>/dev/null

# ═══════════════════════════════════════════════════════
# 2. Validate hook scripts are executable
# ═══════════════════════════════════════════════════════
if [ -d "$HOOKS_DIR" ]; then
  HOOK_ISSUES=0
  for hook in "$HOOKS_DIR"/*.sh; do
    [ ! -f "$hook" ] && continue
    if [ ! -x "$hook" ]; then
      chmod +x "$hook" 2>/dev/null
      HOOK_ISSUES=$((HOOK_ISSUES + 1))
    fi
  done
  if [ "$HOOK_ISSUES" -gt 0 ]; then
    echo "- \`$(date +"%Y-%m-%d %H:%M:%S")\` | SESSION | INFO | Fixed permissions on $HOOK_ISSUES hook scripts" >> "$INCIDENT_LOG"
  fi
fi

# ═══════════════════════════════════════════════════════
# 3. Validate agent definitions have frontmatter
# ═══════════════════════════════════════════════════════
if [ -d "$AGENTS_DIR" ]; then
  AGENT_ISSUES=""
  for agent in "$AGENTS_DIR"/*.md; do
    [ ! -f "$agent" ] && continue
    AGENT_NAME=$(basename "$agent" .md)
    # Check for frontmatter (file should start with ---)
    FIRST_LINE=$(head -1 "$agent" 2>/dev/null)
    if [ "$FIRST_LINE" != "---" ]; then
      AGENT_ISSUES="$AGENT_ISSUES $AGENT_NAME(no-frontmatter)"
    fi
  done
  if [ -n "$AGENT_ISSUES" ]; then
    echo "- \`$(date +"%Y-%m-%d %H:%M:%S")\` | SESSION | WARN | Agent issues:$AGENT_ISSUES" >> "$INCIDENT_LOG"
  fi
fi

# ═══════════════════════════════════════════════════════
# 4. Ensure required directories exist
# ═══════════════════════════════════════════════════════
mkdir -p "$PROJECT_DIR/.claude/agent-memory" \
         "$PROJECT_DIR/.claude/backups" \
         "$PROJECT_DIR/.claude/skills" \
         "$PROJECT_DIR/Daily Notes" \
         "$LOG_DIR" 2>/dev/null

# ═══════════════════════════════════════════════════════
# 5. Prune audit/change logs if over 5000 lines (keep last 2000)
# ═══════════════════════════════════════════════════════
for LOG_FILE in "$LOG_DIR/audit-trail.md" "$LOG_DIR/changes.log" "$LOG_DIR/failures.log"; do
  if [ -f "$LOG_FILE" ]; then
    LINE_COUNT=$(wc -l < "$LOG_FILE" | tr -d ' ')
    if [ "$LINE_COUNT" -gt 5000 ]; then
      tail -2000 "$LOG_FILE" > "$LOG_FILE.tmp"
      mv "$LOG_FILE.tmp" "$LOG_FILE"
      echo "- \`$(date +"%Y-%m-%d %H:%M:%S")\` | SESSION | INFO | Pruned $(basename "$LOG_FILE") from $LINE_COUNT to 2000 lines" >> "$INCIDENT_LOG"
    fi
  fi
done

exit 0

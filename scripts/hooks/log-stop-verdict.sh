#!/bin/bash
# Stop hook — logs the quality verdict from the review prompt.
# Adapted for sed-based parsing (no jq dependency).
# Tracks session blocks and activates quality gate at >=2 blocks.
#
# Expected stdin format (simple text, not JSON):
#   Line 1: PASS | WARN | BLOCK
#   Line 2 (optional): reason text
#   Line 3 (optional): learning text

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG_DIR="$PROJECT_DIR/.claude/logs"
VERDICT_LOG="$LOG_DIR/verdicts.log"
INCIDENT_LOG="$LOG_DIR/incident-log.md"
NOMINATIONS="$PROJECT_DIR/.claude/knowledge-nominations.md"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
SESSION_DATE=$(date +"%m%d-%H")
BLOCK_FILE="$LOG_DIR/.session-blocks-$SESSION_DATE"

mkdir -p "$LOG_DIR"

# Read verdict from stdin
RAW_VERDICT=$(cat)

# Parse the verdict — try to extract decision from various formats
# Format 1: Simple keyword on first line (PASS, WARN, BLOCK)
DECISION=$(echo "$RAW_VERDICT" | head -1 | sed -n 's/.*\(PASS\|WARN\|BLOCK\).*/\1/p' | head -1)

# Format 2: Try JSON-like format with sed (fallback)
if [ -z "$DECISION" ]; then
  DECISION=$(echo "$RAW_VERDICT" | sed -n 's/.*"decision"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
fi

# Default if not parseable
if [ -z "$DECISION" ]; then
  DECISION="unknown"
fi

# Extract reason (second line or JSON field)
REASON=$(echo "$RAW_VERDICT" | sed -n '2p' | head -c 200)
if [ -z "$REASON" ]; then
  REASON=$(echo "$RAW_VERDICT" | sed -n 's/.*"reason"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
fi

# Extract learning (third line or JSON field)
LEARNING=$(echo "$RAW_VERDICT" | sed -n '3p')
if [ -z "$LEARNING" ]; then
  LEARNING=$(echo "$RAW_VERDICT" | sed -n 's/.*"learning"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
fi

# Write verdict to log (simple text format — no jq needed)
echo "- \`$TIMESTAMP\` | $DECISION | $REASON" >> "$VERDICT_LOG"

# Track blocks
if [ "$DECISION" = "BLOCK" ] || [ "$DECISION" = "block" ]; then
  BLOCK_COUNT=1
  if [ -f "$BLOCK_FILE" ]; then
    BLOCK_COUNT=$(( $(cat "$BLOCK_FILE") + 1 ))
  fi
  echo "$BLOCK_COUNT" > "$BLOCK_FILE"

  echo "- \`$TIMESTAMP\` | VERDICT | BLOCK | $REASON" >> "$INCIDENT_LOG"

  # Activate quality gate at >=2 blocks in same session
  if [ "$BLOCK_COUNT" -ge 2 ]; then
    touch "$LOG_DIR/.quality-gate-active"
    echo "- \`$TIMESTAMP\` | VERDICT | WARN | Quality gate activated — $BLOCK_COUNT blocks this session" >> "$INCIDENT_LOG"
  fi
fi

# Nominate learning if present
if [ -n "$LEARNING" ] && [ "$LEARNING" != "null" ] && [ "$LEARNING" != "" ]; then
  NOMINATION_DATE=$(date +"%m%d%y")
  echo "- [$NOMINATION_DATE] stop-hook: $LEARNING | Evidence: session verdict ($DECISION)" >> "$NOMINATIONS"
fi

exit 0

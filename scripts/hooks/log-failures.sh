#!/bin/bash
# PostToolUseFailure hook — categorizes and logs tool failures.
# Uses sed for JSON parsing (no jq dependency).
#
# Categories: BUILD, API, FILESYSTEM, NETWORK, PERMISSION, OTHER
# Severities: CRITICAL, ERROR, WARN, INFO

read -r INPUT

TOOL=$(echo "$INPUT" | sed -n 's/.*"tool_name"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
# Fallback: try "tool" key if "tool_name" not found
if [ -z "$TOOL" ]; then
  TOOL=$(echo "$INPUT" | sed -n 's/.*"tool"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
fi

ERROR=$(echo "$INPUT" | sed -n 's/.*"error"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
# Fallback: try "tool_result" key
if [ -z "$ERROR" ]; then
  ERROR=$(echo "$INPUT" | sed -n 's/.*"tool_result"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG_DIR="$PROJECT_DIR/.claude/logs"
FAILURE_LOG="$LOG_DIR/failure-log.md"
INCIDENT_LOG="$LOG_DIR/incident-log.md"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

mkdir -p "$LOG_DIR"

# ═══════════════════════════════════════════════════════
# Categorize the failure
# ═══════════════════════════════════════════════════════
CATEGORY="OTHER"
SEVERITY="ERROR"

case "$ERROR" in
  *"ENOENT"*|*"No such file"*|*"not found"*|*"does not exist"*)
    CATEGORY="FILESYSTEM"
    SEVERITY="WARN"
    ;;
  *"EACCES"*|*"Permission denied"*|*"EPERM"*|*"Access denied"*)
    CATEGORY="PERMISSION"
    SEVERITY="ERROR"
    ;;
  *"ECONNREFUSED"*|*"ETIMEDOUT"*|*"fetch failed"*|*"network"*|*"ECONNRESET"*|*"DNS"*)
    CATEGORY="NETWORK"
    SEVERITY="ERROR"
    ;;
  *"401"*|*"403"*|*"429"*|*"500"*|*"API"*|*"rate limit"*|*"Unauthorized"*)
    CATEGORY="API"
    SEVERITY="ERROR"
    ;;
  *"build"*|*"compile"*|*"syntax"*|*"TypeError"*|*"ReferenceError"*|*"SyntaxError"*)
    CATEGORY="BUILD"
    SEVERITY="ERROR"
    ;;
  *"CRITICAL"*|*"fatal"*|*"panic"*|*"ENOMEM"*|*"out of memory"*)
    CATEGORY="OTHER"
    SEVERITY="CRITICAL"
    ;;
esac

# Truncate error message for log readability (max 200 chars)
SHORT_ERROR=$(echo "$ERROR" | head -1 | cut -c1-200)

# ═══════════════════════════════════════════════════════
# Write to failure log
# ═══════════════════════════════════════════════════════
echo "- \`$TIMESTAMP\` | $SEVERITY | $CATEGORY | $TOOL | $SHORT_ERROR" >> "$FAILURE_LOG"

# Also write to incident log if ERROR or CRITICAL
if [ "$SEVERITY" = "ERROR" ] || [ "$SEVERITY" = "CRITICAL" ]; then
  echo "- \`$TIMESTAMP\` | FAILURE | $SEVERITY | $CATEGORY | $TOOL | $SHORT_ERROR" >> "$INCIDENT_LOG"
fi

# ═══════════════════════════════════════════════════════
# Repeated-failure detection (our unique feature)
# Warn if same tool has failed 3+ times this session
# ═══════════════════════════════════════════════════════
if [ -n "$TOOL" ] && [ -f "$FAILURE_LOG" ]; then
  FAIL_COUNT=$(grep -c "$TOOL" "$FAILURE_LOG" 2>/dev/null || echo 0)
  if [ "$FAIL_COUNT" -ge 3 ]; then
    echo "$TOOL hat wiederholt Fehler ($FAIL_COUNT Mal) — erwaege ein Learning zu diesem Tool oder pruefe die Grundursache." >&2
  fi
fi

exit 0

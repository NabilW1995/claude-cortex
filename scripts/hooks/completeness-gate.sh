#!/bin/bash
# PreToolUse completeness gate for Write|Edit tools.
# Validates content completeness for critical system files before allowing writes.
# Uses sed for JSON parsing (no jq dependency).
#
# Exit 2 = BLOCK, Exit 0 = ALLOW.
#
# Philosophy: Only gate files where an incomplete write causes persistent damage.
# Daily notes, scratchpad, logs, templates = ungated (iterative by nature).
# Knowledge-base, settings, agent defs = gated (errors persist/cascade).

read -r INPUT

FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"file_path"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
TOOL_NAME=$(echo "$INPUT" | sed -n 's/.*"tool_name"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)

# Skip if no file path
[ -z "$FILE_PATH" ] && exit 0

# Get content based on tool type
if [ "$TOOL_NAME" = "Write" ]; then
  CONTENT=$(echo "$INPUT" | sed -n 's/.*"content"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
else
  CONTENT=$(echo "$INPUT" | sed -n 's/.*"new_string"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
fi

# Skip if no content to validate
[ -z "$CONTENT" ] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
LOG_DIR="$PROJECT_DIR/.claude/logs"
INCIDENT_LOG="$LOG_DIR/incident-log.md"

mkdir -p "$LOG_DIR"

# Get relative path for matching
RELATIVE_PATH="${FILE_PATH#$PROJECT_DIR/}"

log_incident() {
  local SEVERITY="$1"
  local MSG="$2"
  echo "- \`$TIMESTAMP\` | COMPLETENESS | $SEVERITY | $MSG" >> "$INCIDENT_LOG"
}

block() {
  local MSG="$1"
  log_incident "HIGH" "BLOCKED: $MSG -> $RELATIVE_PATH"
  echo "COMPLETENESS GATE: $MSG" >&2
  echo "   File: $RELATIVE_PATH" >&2
  exit 2
}

warn() {
  local MSG="$1"
  log_incident "MEDIUM" "WARN: $MSG -> $RELATIVE_PATH"
  echo "COMPLETENESS WARNING: $MSG" >&2
  echo "   File: $RELATIVE_PATH" >&2
}

# ═══════════════════════════════════════════════════════
# SECRET DETECTION (runs on ALL non-.env files)
# Catches accidental credential leaks in code/config files.
# ═══════════════════════════════════════════════════════

# Allow .env files and backups to contain secrets
IS_ENV_FILE=false
case "$RELATIVE_PATH" in
  *.env*|.claude/backups/*) IS_ENV_FILE=true ;;
esac

if [ "$IS_ENV_FILE" = "false" ]; then
  # Stripe keys (sk_live_, sk_test_)
  if echo "$CONTENT" | grep -qE 'sk[-_](live|test)[-_][A-Za-z0-9]{20,}'; then
    block "SECURITY: Content contains what appears to be a Stripe API key. Secrets must NEVER be in code files — use .env instead."
  fi
  # Anthropic keys (sk-ant-)
  if echo "$CONTENT" | grep -qE 'sk-ant-[A-Za-z0-9]{20,}'; then
    block "SECURITY: Content contains what appears to be an Anthropic API key. Use .env instead."
  fi
  # GitHub tokens (ghp_, ghs_)
  if echo "$CONTENT" | grep -qE 'gh[ps]_[A-Za-z0-9]{36}'; then
    block "SECURITY: Content contains what appears to be a GitHub token. Use .env instead."
  fi
  # AWS access keys (AKIA...)
  if echo "$CONTENT" | grep -qE 'AKIA[0-9A-Z]{16}'; then
    block "SECURITY: Content contains what appears to be an AWS access key. Use .env instead."
  fi
  # Slack tokens (xoxb-, xoxp-, xoxs-)
  if echo "$CONTENT" | grep -qE 'xox[bps]-[A-Za-z0-9-]{20,}'; then
    block "SECURITY: Content contains what appears to be a Slack token. Use .env instead."
  fi
  # JWT tokens (eyJhbGci...)
  if echo "$CONTENT" | grep -qE 'eyJhbGci[A-Za-z0-9+/=]{50,}'; then
    block "SECURITY: Content contains what appears to be a JWT token. Use .env instead."
  fi
  # Basic auth in URLs (https://user:pass@host)
  if echo "$CONTENT" | grep -qE 'https?://[^:]+:[^@]+@[a-zA-Z]'; then
    block "SECURITY: Content contains basic auth credentials in a URL. Use .env instead."
  fi
fi

# ═══════════════════════════════════════════════════════
# PATH-SPECIFIC GATES
# ═══════════════════════════════════════════════════════

case "$RELATIVE_PATH" in

  # ─── KNOWLEDGE BASE ─────────────────────────────────
  # Institutional memory. Errors here persist forever.
  # Rules: provenance required, max 200 lines, no TBD.
  ".claude/knowledge-base.md"|*"knowledge-base.md")
    # Check for TBD/TODO/FIXME markers
    if echo "$CONTENT" | grep -qiE '\bTBD\b|\bTODO\b|\bFIXME\b|\[PLACEHOLDER\]|\[INSERT '; then
      block "Contains TBD/TODO/FIXME/PLACEHOLDER markers. Content must be investigation-complete."
    fi

    if [ "$TOOL_NAME" = "Write" ]; then
      # Every bold entry line must have a [Source:] tag
      ENTRY_COUNT=$(echo "$CONTENT" | grep -cE '^\s*-\s+\*\*' 2>/dev/null || echo 0)
      SOURCE_COUNT=$(echo "$CONTENT" | grep -cE '\[Source:' 2>/dev/null || echo 0)

      if [ "$ENTRY_COUNT" -gt 0 ] && [ "$SOURCE_COUNT" -lt "$ENTRY_COUNT" ]; then
        MISSING=$((ENTRY_COUNT - SOURCE_COUNT))
        block "Knowledge-base has $MISSING entries missing [Source:] provenance. Every entry MUST cite its source."
      fi

      # Max 200 lines
      LINE_COUNT=$(echo "$CONTENT" | wc -l | tr -d ' ')
      if [ "$LINE_COUNT" -gt 200 ]; then
        block "Knowledge-base is $LINE_COUNT lines (max 200). Remove stale entries before adding new ones."
      fi
    fi
    ;;

  # ─── SETTINGS.JSON ─────────────────────────────────
  # Hook configuration. Broken JSON = all hooks break.
  # Rules: must be valid JSON.
  ".claude/settings.json"|*"settings.json")
    if [ "$TOOL_NAME" = "Write" ]; then
      # Validate JSON using node (available in all our environments)
      if ! echo "$CONTENT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{JSON.parse(d)}catch(e){process.exit(1)}})" 2>/dev/null; then
        block "settings.json would be invalid JSON. Syntax error will break ALL hooks. Use Edit for targeted changes."
      fi
    fi
    ;;

  # ─── AGENT DEFINITIONS ──────────────────────────────
  # Agent instructions. Must be definitive, not speculative.
  # Rules: no TBD/TODO.
  .claude/agents/*.md|*".claude/agents/"*)
    if echo "$CONTENT" | grep -qiE '\bTBD\b|\bTODO\b|\bFIXME\b|\[PLACEHOLDER\]|\[INSERT '; then
      block "Agent definition contains TBD/TODO/FIXME markers. Agent instructions must be definitive."
    fi
    if echo "$CONTENT" | grep -qiE 'assess whether|decide later|need to determine|open question|to be decided'; then
      block "Agent definition contains deferred decisions. Make definitive statements."
    fi
    ;;

  # ─── ALL OTHER FILES: PASS THROUGH ─────────────────
  *)
    ;;

esac

# ═══════════════════════════════════════════════════════
# DEBT-COLLECTOR: Track TODO count across project
# (Our unique feature — not in Claudify)
# ═══════════════════════════════════════════════════════
DEBT_FILE="$LOG_DIR/.debt-count"

TODO_COUNT=$(grep -riE "(TODO|FIXME|HACK|XXX)" "$PROJECT_DIR/src" "$PROJECT_DIR/scripts" 2>/dev/null | grep -v node_modules | grep -v ".claude/" | wc -l | tr -d ' ')

if [ -f "$DEBT_FILE" ]; then
  PREV_COUNT=$(cat "$DEBT_FILE" 2>/dev/null || echo 0)
else
  PREV_COUNT=0
fi

echo "$TODO_COUNT" > "$DEBT_FILE"

if [ "$TODO_COUNT" -ge 20 ] && [ "$TODO_COUNT" -gt "$PREV_COUNT" ]; then
  echo "[Debt-Collector] $TODO_COUNT TODOs/FIXMEs im Projekt (steigend!) — erwaege /debt-map fuer eine Uebersicht." >&2
fi

# Warn (but don't block) on TODO markers in regular code
if echo "$CONTENT" | grep -qiE "(TODO|TBD|FIXME|HACK|XXX|PLACEHOLDER)"; then
  warn "Code enthaelt TODO/TBD/FIXME Marker — stelle sicher dass diese vor dem Commit aufgeloest werden."
fi

exit 0

#!/bin/bash
# PreToolUse hook for Bash commands.
# Three-tier blocking system:
#   HARD BLOCK  — always blocked, no override (exit 2)
#   SECRET EXPOSURE — credential leak prevention (exit 2)
#   SOFT BLOCK  — blocked with warning, user can re-request (exit 2)
#
# Uses sed for JSON parsing (no jq dependency).
# Exit 2 = BLOCK, Exit 0 = ALLOW.

read -r INPUT

COMMAND=$(echo "$INPUT" | sed -n 's/.*"command"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)

# Skip if no command extracted
[ -z "$COMMAND" ] && exit 0

TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG_DIR="$PROJECT_DIR/.claude/logs"
INCIDENT_LOG="$LOG_DIR/incident-log.md"

mkdir -p "$LOG_DIR"

log_incident() {
  local SEVERITY="$1"
  local MSG="$2"
  echo "- \`$TIMESTAMP\` | GUARD | $SEVERITY | $MSG" >> "$INCIDENT_LOG"
}

block() {
  local TIER="$1"
  local REASON="$2"
  echo "$TIER: $REASON" >&2
  echo "   Command: $COMMAND" >&2
  echo "   Ask the user for explicit permission before running this." >&2
  exit 2
}

# ═══════════════════════════════════════════════════════
# HARD BLOCK — never allowed, no exceptions
# ═══════════════════════════════════════════════════════

# rm -rf / or rm -rf ~ or rm -rf $HOME (catastrophic)
if echo "$COMMAND" | grep -qE 'rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(/|~|\$HOME)\s*$'; then
  log_incident "CRITICAL" "BLOCKED: catastrophic rm -> $COMMAND"
  block "HARD BLOCK" "This would delete your entire filesystem or home directory."
fi

# git push --force (any variant)
if echo "$COMMAND" | grep -qE 'git\s+push\s+.*--force|git\s+push\s+-f'; then
  log_incident "CRITICAL" "BLOCKED: force push -> $COMMAND"
  block "HARD BLOCK" "Force push rewrites shared history and can destroy teammates' work."
fi

# git reset --hard (destroys uncommitted work)
if echo "$COMMAND" | grep -qE 'git\s+reset\s+--hard'; then
  log_incident "HIGH" "BLOCKED: git reset --hard -> $COMMAND"
  block "HARD BLOCK" "git reset --hard destroys all uncommitted changes. Use git stash instead."
fi

# git clean -f (deletes untracked files permanently)
if echo "$COMMAND" | grep -qE 'git\s+clean\s+(-[a-zA-Z]*f|-f)'; then
  log_incident "HIGH" "BLOCKED: git clean -f -> $COMMAND"
  block "HARD BLOCK" "git clean -f permanently deletes untracked files. Use git stash instead."
fi

# chmod 777 (security risk — grants full access to all users)
if echo "$COMMAND" | grep -qE 'chmod\s+777'; then
  log_incident "HIGH" "BLOCKED: chmod 777 -> $COMMAND"
  block "HARD BLOCK" "chmod 777 grants full access to all users. Use 755 or 644 instead."
fi

# mkfs (format disk)
if echo "$COMMAND" | grep -qiE 'mkfs\.'; then
  log_incident "CRITICAL" "BLOCKED: mkfs -> $COMMAND"
  block "HARD BLOCK" "mkfs formats a disk partition, destroying all data."
fi

# dd if= (raw disk write — can destroy data)
if echo "$COMMAND" | grep -qiE 'dd\s+if='; then
  log_incident "CRITICAL" "BLOCKED: dd -> $COMMAND"
  block "HARD BLOCK" "dd can overwrite disk partitions and destroy data."
fi

# Fork bomb
if echo "$COMMAND" | grep -qE ':\(\)\s*\{.*\|.*&\s*\}\s*;'; then
  log_incident "CRITICAL" "BLOCKED: fork bomb -> $COMMAND"
  block "HARD BLOCK" "Fork bomb detected. This would crash the system."
fi

# DROP DATABASE / DROP TABLE / TRUNCATE (destructive SQL)
if echo "$COMMAND" | grep -qiE '(DROP\s+DATABASE|DROP\s+TABLE|TRUNCATE\s+)'; then
  log_incident "CRITICAL" "BLOCKED: destructive SQL -> $COMMAND"
  block "HARD BLOCK" "Destructive SQL command detected. This would permanently delete data."
fi

# ═══════════════════════════════════════════════════════
# SECRET EXPOSURE — block commands that leak credentials
# ═══════════════════════════════════════════════════════

# Block cat/head/tail/less of .env files (prevents full credential dump)
if echo "$COMMAND" | grep -qE '(cat|head|tail|less|more|bat)\s+.*\.(env|env\.local|env\.production|env\.staging)'; then
  log_incident "HIGH" "BLOCKED: credential file read -> $COMMAND"
  block "SECRET BLOCK" "Reading .env files via shell exposes secrets in output. Use grep -c KEY_NAME to check if a key exists."
fi

# Block echo/printf of secret environment variables
if echo "$COMMAND" | grep -qE '(echo|printf)\s+.*\$(STRIPE_|OPENAI_|ANTHROPIC_|AWS_|DATABASE_|AUTH_SECRET|NEXTAUTH_SECRET|API_KEY|SECRET_KEY|PRIVATE_KEY)'; then
  log_incident "HIGH" "BLOCKED: secret echo -> $COMMAND"
  block "SECRET BLOCK" "Echoing secret environment variables exposes credentials. Reference by name only."
fi

# Block piping credential files to network commands
if echo "$COMMAND" | grep -qE '\.(env|env\.local|env\.production).*\|\s*(curl|wget|nc|ncat)'; then
  log_incident "CRITICAL" "BLOCKED: credential file piped to network -> $COMMAND"
  block "SECRET BLOCK" "Piping credential files to network commands would exfiltrate secrets."
fi

# Block git add of credential files
if echo "$COMMAND" | grep -qE 'git\s+add\s+.*\.(env|env\.local|env\.production|env\.staging)'; then
  log_incident "CRITICAL" "BLOCKED: git add of credential file -> $COMMAND"
  block "SECRET BLOCK" "Staging .env files for git commit would expose secrets publicly. These must stay in .gitignore."
fi

# Block curl/wget uploading credential files
if echo "$COMMAND" | grep -qE '(curl|wget)\s+.*(-d\s+@|-F\s+.*=@).*\.(env|credentials|key|pem)'; then
  log_incident "CRITICAL" "BLOCKED: credential file upload -> $COMMAND"
  block "SECRET BLOCK" "Uploading credential files to remote servers."
fi

# ═══════════════════════════════════════════════════════
# SOFT BLOCK — blocked, but user can re-request
# ═══════════════════════════════════════════════════════

# rm with -r or -f flags (recursive/force delete)
if echo "$COMMAND" | grep -qE 'rm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)'; then
  # Allow rm on .claude/backups and .claude/logs temp files (rotation)
  if echo "$COMMAND" | grep -qE '\.claude/(backups|logs/\.)'; then
    : # allowed — these are managed by other hooks
  else
    log_incident "MEDIUM" "SOFT BLOCKED: recursive/force rm -> $COMMAND"
    block "SOFT BLOCK" "rm with -r or -f deletes files permanently. Confirm specific paths with the user."
  fi
fi

# curl piped to shell (arbitrary code execution)
if echo "$COMMAND" | grep -qE 'curl\s.*\|\s*(bash|sh|zsh)'; then
  log_incident "HIGH" "SOFT BLOCKED: curl pipe to shell -> $COMMAND"
  block "SOFT BLOCK" "Piping curl to a shell executes arbitrary remote code. Download first, inspect, then run."
fi

# wget piped to shell
if echo "$COMMAND" | grep -qE 'wget\s.*\|\s*(bash|sh|zsh)'; then
  log_incident "HIGH" "SOFT BLOCKED: wget pipe to shell -> $COMMAND"
  block "SOFT BLOCK" "Piping wget to a shell executes arbitrary remote code. Download first, inspect, then run."
fi

# --no-verify flag (skips git hooks)
if echo "$COMMAND" | grep -qE '\-\-no-verify'; then
  log_incident "MEDIUM" "SOFT BLOCKED: --no-verify -> $COMMAND"
  block "SOFT BLOCK" "The --no-verify flag skips safety hooks. Run without it or get explicit user permission."
fi

# ═══════════════════════════════════════════════════════
# LOG WARNING — allowed but recorded
# ═══════════════════════════════════════════════════════

# Any rm command (non-recursive, non-force)
if echo "$COMMAND" | grep -qE '\brm\b'; then
  log_incident "LOW" "WARNING: rm command allowed -> $COMMAND"
fi

# git checkout that discards changes
if echo "$COMMAND" | grep -qE 'git\s+checkout\s+\.'; then
  log_incident "MEDIUM" "WARNING: git checkout . discards changes -> $COMMAND"
fi

exit 0

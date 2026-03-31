#!/bin/bash
# Guard against dangerous bash commands
# Reads tool input from stdin, exits with code 2 to BLOCK

read -r INPUT

COMMAND=$(echo "$INPUT" | sed -n 's/.*"command"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)

# Block dangerous commands
BLOCKED_PATTERNS=(
  "rm -rf /"
  "rm -rf ~"
  "rm -rf \."
  "rm -rf \*"
  ":(){ :|:& };:"
  "mkfs\."
  "dd if="
  "> /dev/sd"
  "chmod -R 777 /"
  "curl.*|.*bash"
  "wget.*|.*bash"
  "git push.*--force.*main"
  "git push.*--force.*master"
  "git reset --hard"
  "DROP DATABASE"
  "DROP TABLE"
  "TRUNCATE"
  "--no-verify"
)

for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qiE "$pattern"; then
    echo "⛔ BLOCKED: Dangerous command detected: $pattern" >&2
    echo "   Command: $COMMAND" >&2
    echo "   Ask the user for explicit permission before running this." >&2
    exit 2
  fi
done

exit 0

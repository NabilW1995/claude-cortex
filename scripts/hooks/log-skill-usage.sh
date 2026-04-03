#!/bin/bash
# Log which skills and commands are invoked for usage analytics
# Triggered by PreToolUse on Skill tool

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
LOG_FILE="$PROJECT_DIR/.claude/logs/skill-usage.jsonl"

# Read stdin for tool info
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ -n "$TOOL_NAME" ]; then
  mkdir -p "$(dirname "$LOG_FILE")"
  echo "{\"timestamp\":\"$TIMESTAMP\",\"tool\":\"$TOOL_NAME\"}" >> "$LOG_FILE"
fi

exit 0

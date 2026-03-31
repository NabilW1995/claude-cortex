#!/bin/bash
# Check if tests exist for files being committed
# Runs before git commit

read -r INPUT

COMMAND=$(echo "$INPUT" | sed -n 's/.*"command"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)

# Only check on git commit
if ! echo "$COMMAND" | grep -q "git commit"; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Get staged files
STAGED_FILES=$(cd "$PROJECT_DIR" && git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep -E '\.(ts|tsx|js|jsx|py)$' | grep -v '\.test\.\|\.spec\.\|__tests__')

MISSING_TESTS=""
for FILE in $STAGED_FILES; do
  # Skip config and type files
  if echo "$FILE" | grep -qE "(config|types|index|constants)"; then
    continue
  fi

  BASENAME=$(basename "$FILE" | sed 's/\.[^.]*$//')

  # Check for corresponding test file
  if ! find "$PROJECT_DIR" -name "${BASENAME}.test.*" -o -name "${BASENAME}.spec.*" 2>/dev/null | grep -q .; then
    MISSING_TESTS="${MISSING_TESTS}\n  - $FILE"
  fi
done

if [ -n "$MISSING_TESTS" ]; then
  echo "⚠️  Fehlende Tests für geänderte Dateien:${MISSING_TESTS}" >&2
  echo "   Tipp: Schreibe Tests bevor du committest (TDD)" >&2
fi

exit 0

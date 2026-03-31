#!/bin/bash
# Run relevant tests after file edits
# Runs asynchronously to not block the workflow

read -r INPUT

FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"file_path"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Skip test files themselves and config files
if echo "$FILE_PATH" | grep -qE "(\.test\.|\.spec\.|__tests__|\.config\.|\.json$)"; then
  exit 0
fi

# Run related tests if test runner is available
if [ -f "$PROJECT_DIR/node_modules/.bin/vitest" ]; then
  "$PROJECT_DIR/node_modules/.bin/vitest" run --related "$FILE_PATH" 2>&1 | tail -5 >&2
elif [ -f "$PROJECT_DIR/node_modules/.bin/jest" ]; then
  "$PROJECT_DIR/node_modules/.bin/jest" --findRelatedTests "$FILE_PATH" --passWithNoTests 2>&1 | tail -5 >&2
elif command -v pytest &>/dev/null && echo "$FILE_PATH" | grep -qE "\.py$"; then
  pytest --tb=short -q 2>&1 | tail -5 >&2
fi

exit 0

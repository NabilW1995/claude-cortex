#!/bin/bash
# Auto-lint after file edits
# Runs asynchronously — does not block

read -r INPUT
FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"file_path"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

EXTENSION="${FILE_PATH##*.}"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

case "$EXTENSION" in
  js|jsx|ts|tsx|mjs|cjs)
    if [ -f "$PROJECT_DIR/node_modules/.bin/eslint" ]; then
      "$PROJECT_DIR/node_modules/.bin/eslint" --fix "$FILE_PATH" 2>/dev/null
    elif [ -f "$PROJECT_DIR/node_modules/.bin/biome" ]; then
      "$PROJECT_DIR/node_modules/.bin/biome" check --write "$FILE_PATH" 2>/dev/null
    fi
    ;;
  py)
    if command -v ruff &>/dev/null; then
      ruff format "$FILE_PATH" 2>/dev/null
    elif command -v black &>/dev/null; then
      black "$FILE_PATH" 2>/dev/null
    fi
    ;;
  css|scss)
    if [ -f "$PROJECT_DIR/node_modules/.bin/prettier" ]; then
      "$PROJECT_DIR/node_modules/.bin/prettier" --write "$FILE_PATH" 2>/dev/null
    fi
    ;;
esac

exit 0

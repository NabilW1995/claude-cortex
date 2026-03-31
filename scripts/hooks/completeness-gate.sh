#!/bin/bash
# Warn about TODO/TBD/FIXME in code being written
# Does NOT block — just warns

read -r INPUT

CONTENT=$(echo "$INPUT" | sed -n 's/.*"content"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
NEW_STRING=$(echo "$INPUT" | sed -n 's/.*"new_string"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)

CHECK_TEXT="${CONTENT}${NEW_STRING}"

if echo "$CHECK_TEXT" | grep -qiE "(TODO|TBD|FIXME|HACK|XXX|PLACEHOLDER)"; then
  echo "⚠️  Code enthält TODO/TBD/FIXME Marker — stelle sicher dass diese vor dem Commit aufgelöst werden." >&2
fi

exit 0

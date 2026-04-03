---
description: "Starts a recurring test watcher loop. Use when user wants continuous testing, test monitoring, or says 'watch the tests', 'keep testing'."
---

# Loop: Watch Tests

Starts `/loop 10m "Run all tests and report any failures"` — every 10 minutes, Claude runs the test suite and reports issues.

## What It Does

1. Runs the full test suite every 10 minutes
2. Reports any new failures immediately
3. Suggests fixes for broken tests
4. Tracks which tests flipped from pass to fail

## Usage

Start: `/loop-watch-tests`
Stop: Cancel the cron job when done (shown in output)

## Notes

- Useful during large refactors to catch regressions early
- Runs in the background — you can keep working
- Auto-expires after 3 days
- Session-scoped — stops when Claude exits

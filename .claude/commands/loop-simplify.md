---
description: "Starts a recurring code simplification loop. Use when user wants continuous cleanup, code quality improvement, or says 'keep the code clean'."
---

# Loop: Simplify Code

Starts `/loop 30m /simplify` — every 30 minutes, Claude reviews recently changed code for reuse, quality, and efficiency, then fixes any issues found.

## What It Does

1. Runs the built-in `/simplify` skill every 30 minutes
2. Reviews recently modified files
3. Removes duplication, simplifies logic, improves naming
4. Auto-commits improvements (if configured)

## Usage

Start: `/loop-simplify`
Stop: Cancel the cron job when done (shown in output)

## Notes

- Runs in the background — you can keep working
- Auto-expires after 3 days
- Session-scoped — stops when Claude exits

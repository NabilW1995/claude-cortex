---
description: "Starts a recurring health check loop. Use when user wants continuous monitoring, health checks, or says 'keep an eye on things', 'monitor the project'."
---

# Loop: Health Check

Starts `/loop 1h /health` — every hour, Claude verifies that Cortex is correctly installed and all hooks, agents, and skills are working.

## What It Does

1. Runs `/health` every hour
2. Checks: agents loaded, hooks registered, settings valid, .env complete
3. Reports any issues found
4. Useful during long development sessions

## Usage

Start: `/loop-health`
Stop: Cancel the cron job when done (shown in output)

## Notes

- Light-weight check — won't slow you down
- Runs in the background
- Auto-expires after 3 days
- Session-scoped — stops when Claude exits

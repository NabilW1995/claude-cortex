---
description: Browser Use CLI commands and rules for E2E testing and visual review
globs: "**/*.{test,spec,e2e}.{ts,tsx,js,jsx}"
---

# Browser Use CLI

## Commands
`browser-use doctor`              # Check installation
`browser-use open <url>`          # Open a page
`browser-use state`               # Show visible elements + indices
`browser-use screenshot [path]`   # Take a screenshot
`browser-use click <index>`       # Click an element
`browser-use input <index> "text"` # Enter text
`browser-use scroll down|up`      # Scroll
`browser-use eval "js code"`      # Execute JavaScript
`browser-use --headed open <url>` # Open browser visibly
`browser-use close --all`         # Close all sessions

## Rules
- MUST: Use Browser Use instead of Playwright for all E2E tests and visual review
- MUST: After every design build — `browser-use screenshot` to verify
- MUST: Set `PYTHONIOENCODING=utf-8` on Windows (emoji fix)
- Sessions remain persistent — no restart needed between commands
- Docs: https://docs.browser-use.com/open-source/browser-use-cli

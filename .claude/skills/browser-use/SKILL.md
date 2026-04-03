---
name: browser-use
description: "Use when user needs browser automation: E2E testing, visual review, form filling, screenshot verification, web scraping, or login testing. Triggers on: 'test in browser', 'screenshot', 'check how it looks', 'E2E test', 'open the page', 'visual review'"
allowed-tools: Bash(browser-use *)
hooks:
  PostToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "echo 'Tip: Run browser-use screenshot after interactions to verify visual state' >&2"
          if: "Bash(browser-use click *)"
---

# Browser Automation with Browser Use CLI

## Core Workflow

Every browser automation follows this pattern:

1. **Open**: `browser-use open <url>`
2. **State**: `browser-use state` (get visible elements + indices)
3. **Interact**: Use indices to click, input, scroll
4. **Re-state**: After navigation or DOM changes, get fresh indices

```bash
browser-use open https://example.com/form
browser-use state
# Output: [0] input "Email", [1] input "Password", [2] button "Submit"

browser-use input 0 "user@example.com"
browser-use input 1 "password123"
browser-use click 2
browser-use state  # Check result
```

## Essential Commands

```bash
# Setup
browser-use doctor                    # Check installation

# Navigation
browser-use open <url>                # Open a page
browser-use --headed open <url>       # Open with visible browser
browser-use close --all               # Close all sessions

# State (like snapshot)
browser-use state                     # Show visible elements + indices

# Interaction (use indices from state)
browser-use click <index>             # Click element
browser-use input <index> "text"      # Enter text in field
browser-use scroll down               # Scroll down
browser-use scroll up                 # Scroll up

# Capture
browser-use screenshot                # Screenshot to temp dir
browser-use screenshot ./output.png   # Screenshot to specific path

# Advanced
browser-use eval "js code"            # Execute JavaScript
```

## Common Patterns

### Visual Review After Building UI

```bash
# MUST do this after every design/UI build
browser-use open http://localhost:3000
browser-use screenshot ./review.png
# Claude examines the screenshot and reports issues
```

### Form Testing

```bash
browser-use open http://localhost:3000/signup
browser-use state
browser-use input 0 "Test User"
browser-use input 1 "test@example.com"
browser-use input 2 "password123"
browser-use click 3
browser-use state  # Verify success page
browser-use screenshot ./form-result.png
```

### Login Flow Testing

```bash
browser-use open http://localhost:3000/login
browser-use state
browser-use input 0 "admin@example.com"
browser-use input 1 "adminpass"
browser-use click 2
browser-use state  # Should show dashboard elements
browser-use screenshot ./dashboard.png
```

### Multi-Page Navigation

```bash
browser-use open http://localhost:3000
browser-use state
browser-use click 5               # Click nav link
browser-use state                  # MUST re-state after navigation
browser-use screenshot ./page2.png
```

### Responsive Testing

```bash
# Test at different viewports via JavaScript
browser-use open http://localhost:3000
browser-use eval "window.resizeTo(375, 812)"   # iPhone size
browser-use screenshot ./mobile.png
browser-use eval "window.resizeTo(1024, 768)"   # Tablet
browser-use screenshot ./tablet.png
browser-use eval "window.resizeTo(1920, 1080)"  # Desktop
browser-use screenshot ./desktop.png
```

## Index Lifecycle (Important)

Indices from `browser-use state` are invalidated when the page changes. Always re-state after:
- Clicking links or buttons that navigate
- Form submissions
- Dynamic content loading (modals, dropdowns)

```bash
browser-use click 5              # Navigates to new page
browser-use state                # MUST re-state to get new indices
browser-use click 0              # Now use new indices
```

## Rules

- MUST: Use Browser Use instead of Playwright for all E2E tests and visual review
- MUST: After every design build — `browser-use screenshot` to verify
- MUST: Set `PYTHONIOENCODING=utf-8` on Windows (emoji fix)
- Sessions remain persistent — no restart needed between commands
- Docs: https://docs.browser-use.com/open-source/browser-use-cli

## Dynamic Context

Browser Use status:
!`browser-use doctor 2>&1 | head -5 || echo "browser-use not installed"`

## Gotchas

- Windows: Set `PYTHONIOENCODING=utf-8` in env or browser-use will crash on emoji output
- Always run `browser-use doctor` first if commands fail — checks Python, browser, dependencies
- Indices change after every navigation — ALWAYS run `browser-use state` before interacting
- `--headed` mode is useful for debugging but slower — use headless (default) for CI/automation
- Sessions are persistent — `browser-use close --all` to clean up when done

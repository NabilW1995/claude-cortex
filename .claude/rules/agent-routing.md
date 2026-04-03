---
description: Agent routing — the core development flow, dispatch rules, and sub-agent restrictions
globs: "**/*"
---

# Agent Routing

## The Core Flow

Every coding task follows this pipeline. No exceptions.

```
Plan Mode (User + Claude)
  → Discuss requirements, design, get approval
        ↓
Claude (Orchestrator)
  → Splits plan into tasks
  → Decides: parallel or sequential
  → Dispatches subagents
        ↓
core--coder Agent(s) — one or more in parallel
  → Writes code + tests
  → Commits after each task
  → Hooks run automatically (lint, tests, security)
        ↓
core--test-runner Agent
  → Runs ALL tests, finds edge cases
  → Writes missing tests
        ↓
core--code-review Agent
  → Fresh context = fresh eyes
  → Quality, architecture, security, simplification
        ↓
Sanity Check (skill)
  → Does everything fit together?
        ↓
Done (or fix round)
```

## Agents

### Core (every coding task, in this order)

| Agent | Purpose |
|-------|---------|
| **core--coder** | Writes code + tests. Subagent for tasks >10 lines. |
| **core--test-runner** | Runs all tests, writes missing ones. MANDATORY after coder. |
| **core--code-review** | Reviews quality + security. MANDATORY after test-runner. |

### Before Coding

| Agent | Purpose |
|-------|---------|
| **pre--architect** | Deep analysis for complex decisions. Dispatch before coding. |

### Problem Solving (reactive)

| Agent | Purpose |
|-------|---------|
| **fix--error-translator** | Translates errors into simple explanations + fixes. |
| **fix--root-cause-finder** | Finds the root cause of bugs, not just symptoms. |

### Utilities

| Agent | Purpose |
|-------|---------|
| **util--pr-writer** | Writes PR descriptions from git diff. |
| **start--onboarding** | One-time codebase scan for new projects. |
| **rpi--requirement-parser** | Parses feature requests into structured requirements. |
| **rpi--product-manager** | Writes user stories, PRDs, acceptance criteria. |
| **rpi--ux-designer** | Creates UI flows, wireframes, UX designs. |

### Drift Detection (dispatched by /drift-check)

| Agent | Purpose |
|-------|---------|
| **util--drift-agents** | Checks for new agent frontmatter fields. |
| **util--drift-skills** | Checks for new skill fields + bundled skills. |
| **util--drift-commands** | Checks for new command fields + built-in commands. |
| **util--drift-settings** | Checks for new settings, hook events, env vars. |
| **util--drift-features** | Checks for new Claude Code features/concepts. |

## Dispatch Rules

- MUST: Dispatch subagent for tasks >10 lines
- MUST: Run core--test-runner after every core--coder task
- MUST: Run core--code-review after test-runner passes
- MUST: Run sanity-check skill after code-review (final gate)
- MUST: Give subagents complete context (files, errors, requirements)
- MUST: Summarize subagent results in simple language
- MUST: For multi-step tasks — ask the user after each milestone before starting the next step (human-gated)
- MUST: Break subtasks small enough to complete in under 50% context window
- MAY: Handle fixes <10 lines directly without subagent

## Sub-Agent Restrictions

- Sub-agents CANNOT see images or screenshots
- If a sub-agent writes UI code: main agent MUST do visual review via `browser-use screenshot`
- Sub-agents follow all CLAUDE.md rules (security, quality, git)
- Hooks run automatically for sub-agents (same project context)

## Parallel Dispatch

- Independent tasks → multiple core--coder agents in parallel
- coder + code-review → NEVER parallel (review needs finished code)
- coder + test-runner → NEVER parallel (tests need the code first)

## Automatic Hooks (no manual trigger needed)

| Hook | What it does |
|------|-------------|
| `post-edit-lint.sh` | Formats code (ESLint/Prettier/Biome) |
| `auto-test.sh` | Runs tests related to changed file |
| `security-scan.sh` | Checks for secrets, XSS, SQL injection |
| `session-start.js` | Loads learnings, checks .env |
| `heartbeat.js` | Sends presence ping to Telegram bot |

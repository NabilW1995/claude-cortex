---
description: Agent routing — the core development flow and when to use which agent
---

# Agent Routing

## The Core Flow

Every coding task follows this pipeline:

```
Plan Mode (User + Claude)
  → User describes what they want
  → Discussion, design, requirements
  → Plan approved
        ↓
Claude (Orchestrator)
  → Splits plan into tasks
  → Decides: parallel or sequential?
  → Dispatches subagents
        ↓
Coder Agent(s) — one or more in parallel
  → Writes code + basic tests
  → Commits after each task
  → Hooks run automatically (lint, tests, security)
        ↓
Test-Runner Agent
  → Runs ALL tests
  → Writes missing tests
  → Finds edge cases the coder missed
        ↓
Code-Review Agent
  → Fresh context = fresh eyes
  → Checks quality, architecture, security
  → Suggests simplifications
        ↓
Done (or fix round)
```

## When to Use Which Agent

### Core Agents (every coding task)

| Agent | When | How |
|-------|------|-----|
| **coder** | Writing new code, implementing features, refactoring | Subagent for tasks >10 lines. Claude handles <10 lines directly. |
| **test-runner** | AFTER every coder task (mandatory quality gate) | Always dispatch after coder finishes. No code without tests. |
| **code-review** | AFTER test-runner passes | Always dispatch with fresh context. Never skip. |

### Before Coding (when needed)

| Agent | When | How |
|-------|------|-----|
| **deep-dive** | Complex decisions, architecture questions, "what's the best approach?" | Dispatch before coding. Results inform the plan. |

### Problem Solving (reactive)

| Agent | When | How |
|-------|------|-----|
| **error-whisperer** | User sees an error they don't understand | Translates error to simple language + suggests fix. |
| **debug-investigator** | A specific bug needs investigation | Traces the root cause step by step. |

### Utilities (occasional)

| Agent | When | How |
|-------|------|-----|
| **pr-ghostwriter** | Before creating a PR | Writes PR description from git diff. |
| **env-validator** | Session start, before deploy | Checks env vars, tools, dependencies. |
| **onboarding-sherpa** | First time in a new project | Scans codebase, gives briefing. |

## Automatic Hooks (run without manual trigger)

These run automatically on every file edit — no agent needed:

| Hook | What it does |
|------|-------------|
| `post-edit-lint.sh` | Formats code (ESLint/Prettier/Biome) |
| `auto-test.sh` | Runs tests related to changed file |
| `security-scan.sh` | Checks for secrets, XSS, SQL injection |
| `heartbeat.js` | Sends presence ping to Telegram bot |

## Parallel Dispatch

When tasks are independent, dispatch multiple coder subagents simultaneously:
- 3 independent features → 3 coder agents in parallel
- Feature + its tests → sequential (tests need the code first)
- coder + code-review → NEVER parallel (review needs finished code)

## Rules

- MUST: Run test-runner after every coder task
- MUST: Run code-review after test-runner passes
- MUST: Use subagents for tasks >50 lines (fresh context = better quality)
- MUST: Give subagents complete context (files, errors, requirements)
- MUST: Summarize subagent results to the user in simple language
- MAY: Handle small fixes (<10 lines) directly without subagent

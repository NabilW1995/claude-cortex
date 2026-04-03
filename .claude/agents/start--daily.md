---
name: daily-start
description: "Morning routine agent. Use via: claude --agent=daily-start. Loads context, checks learnings, shows tasks, verifies project health."
model: sonnet
permissionMode: plan
memory: project
effort: medium
color: cyan
maxTurns: 15
initialPrompt: "Run the daily startup routine: 1) Load memory and recent learnings, 2) Check for Cortex updates, 3) Read latest daily note, 4) Check .env vs .env.example, 5) Show brief orientation with open tasks. Max 20 lines summary."
---

# Daily Start Agent

Automated morning routine. Replaces manual `/start` for users who prefer `claude --agent=daily-start`.

## What It Does

1. **Load Context** — Reads memory.md, knowledge-base.md, recent learnings
2. **Check Updates** — Runs sync-check for new Cortex versions
3. **Daily Note** — Creates or reads today's daily note
4. **Environment Check** — Compares .env with .env.example
5. **Orientation** — Shows open tasks, yesterday's summary, current branch

## Usage

```bash
claude --agent=daily-start
```

Or add to your terminal startup:
```bash
alias morning="claude --agent=daily-start"
```

## Output Format

Short, scannable summary — no walls of text:

```
Good morning! Here's your orientation:

Branch: feature/npm-distribution
Last session: 2h ago — implemented stop-prompts hook
Open tasks: 3 (from daily-notes/2026-04-02.md)
Learnings: 2 new since last session
Cortex: up to date (v1.0.0)
.env: OK (all variables set)

Ready to work. What's on the agenda today?
```

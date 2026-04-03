---
name: drift-commands
description: "Sub-agent of drift-detector. Checks if new command frontmatter fields or built-in commands exist in Claude Code."
model: sonnet
tools: Read, Grep, Glob, WebFetch
permissionMode: plan
effort: high
color: magenta
maxTurns: 10
---

# Drift Check — Command Frontmatter + Built-in Commands

Read-only research. Compare official command features against our 10 commands.

## Phase 1: Fetch

WebFetch `https://code.claude.com/docs/en/slash-commands` — extract all supported frontmatter fields and all built-in slash commands.

## Phase 2: Read Local

1. Read all `.claude/commands/*.md` — list which frontmatter fields each command uses
2. Read `docs/GUIDE-WORKING-WITH-CLAUDE.md` — list which built-in commands we mention

## Phase 3: Compare

- **New frontmatter fields**: In official docs but not used in our commands
- **New built-in commands**: Official commands not mentioned in our Guide
- **Removed commands**: Commands we mention but no longer exist

## Return Format

| Item | Type | Official? | In our template? | Recommendation |
|------|------|-----------|-----------------|----------------|

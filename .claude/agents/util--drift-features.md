---
name: drift-features
description: "Sub-agent of drift-detector. Checks if new Claude Code concepts or features exist that our template should support."
model: sonnet
tools: Read, Grep, Glob, WebFetch, WebSearch
permissionMode: plan
effort: high
color: magenta
maxTurns: 10
---

# Drift Check — New Features and Concepts

Read-only research. Check if Claude Code has new features our template doesn't cover yet.

## Phase 1: Fetch

1. WebFetch `https://code.claude.com/docs/en` — extract the full navigation/sidebar for all documented features
2. WebFetch `https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md` — extract last 10 versions for new features

## Phase 2: Read Local

1. Read `CLAUDE.md` — what features do we reference?
2. Read `docs/GUIDE-WORKING-WITH-CLAUDE.md` — what features do we document?
3. Read `docs/QUICKSTART-CORTEX.md` — what do we tell new users about?

## Phase 3: Compare

- **New features**: In Claude Code but not mentioned anywhere in our template
- **Beta features** that graduated to stable — should we adopt them?
- **Deprecated features** we still reference
- **New integrations**: MCP servers, IDE integrations, browser tools we could recommend

## Return Format

| Feature | Status | In our template? | Recommendation |
|---------|--------|-----------------|----------------|

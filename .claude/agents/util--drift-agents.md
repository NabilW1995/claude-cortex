---
name: drift-agents
description: "Sub-agent of drift-detector. Checks if new agent frontmatter fields exist in Claude Code that our agents don't use yet."
model: sonnet
tools: Read, Grep, Glob, WebFetch
permissionMode: plan
effort: high
color: magenta
maxTurns: 10
---

# Drift Check — Agent Frontmatter

Read-only research. Compare official agent frontmatter fields against our 10 agents.

## Phase 1: Fetch

WebFetch `https://code.claude.com/docs/en/sub-agents` — extract all supported frontmatter fields with types and descriptions.

## Phase 2: Read Local

Read all `.claude/agents/*.md` (skip CLAUDE.md). For each agent, list which frontmatter fields are used.

## Phase 3: Compare

- **New fields**: In official docs but not used in ANY of our agents — are they useful?
- **Removed fields**: In our agents but no longer in official docs
- **Underused fields**: Official fields used by some agents but missing from others where they'd help

## Return Format

| Field | Official? | Used by our agents? | Recommendation |
|-------|-----------|-------------------|----------------|

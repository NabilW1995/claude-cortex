---
name: drift-skills
description: "Sub-agent of drift-detector. Checks if new skill frontmatter fields or bundled skills exist in Claude Code."
model: sonnet
tools: Read, Grep, Glob, WebFetch
permissionMode: plan
effort: high
color: magenta
maxTurns: 10
---

# Drift Check — Skill Frontmatter + Bundled Skills

Read-only research. Compare official skill frontmatter fields and bundled skills against our 8 skills.

## Phase 1: Fetch

WebFetch `https://code.claude.com/docs/en/skills` — extract all supported frontmatter fields and all bundled skills (skills that ship with Claude Code).

## Phase 2: Read Local

Read all `.claude/skills/*/SKILL.md`. For each skill, list which frontmatter fields are used.

## Phase 3: Compare

- **New frontmatter fields**: In official docs but not in our skills
- **New bundled skills**: Shipped with Claude Code but not mentioned in our Guide
- **Removed fields or skills**: In our config but no longer official

## Return Format

| Item | Type | Official? | In our template? | Recommendation |
|------|------|-----------|-----------------|----------------|

---
name: drift-settings
description: "Sub-agent of drift-detector. Checks if new settings keys, hook events, or env vars exist in Claude Code."
model: sonnet
tools: Read, Grep, Glob, WebFetch
permissionMode: plan
effort: high
color: magenta
maxTurns: 10
---

# Drift Check — Settings, Hooks, Environment Variables

Read-only research. Compare official settings against our settings.json.

## Phase 1: Fetch

WebFetch `https://code.claude.com/docs/en/settings` — extract all settings keys, hook events, permission modes, and environment variables.

## Phase 2: Read Local

Read `.claude/settings.json` — list all configured settings keys, hook events, env vars, and permission rules.

## Phase 3: Compare

- **New settings keys**: In official docs but not in our settings.json
- **New hook events**: Official events not configured in our hooks
- **New env vars**: Useful environment variables we don't set
- **New permission modes**: Modes we don't mention (e.g., auto, sandbox)
- **Changed defaults**: Official defaults that differ from our values

## Return Format

| Item | Type | Official? | In our config? | Recommendation |
|------|------|-----------|---------------|----------------|

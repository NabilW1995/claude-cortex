---
description: "Use when user says 'drift check', 'was gibt es neues?', 'new features?', 'are we up to date?', or after /template-update. Checks for new Claude Code features."
argument-hint: [versions to check, default 10]
---

# Drift Check — What's New in Claude Code?

## Phase 1: Dispatch 5 Research Agents in Parallel

Launch ALL 5 in a single message using the Agent tool:

1. **drift-agents** — "Check the last $ARGUMENTS versions (default 10). Fetch official agent docs, compare against our .claude/agents/*.md files."
2. **drift-skills** — "Check the last $ARGUMENTS versions. Fetch official skill docs, compare against our .claude/skills/*/SKILL.md files."
3. **drift-commands** — "Check the last $ARGUMENTS versions. Fetch official command docs, compare against our .claude/commands/*.md and docs/GUIDE-WORKING-WITH-CLAUDE.md."
4. **drift-settings** — "Check the last $ARGUMENTS versions. Fetch official settings docs, compare against our .claude/settings.json."
5. **drift-features** — "Check the last $ARGUMENTS versions. Fetch docs index + changelog, compare against our CLAUDE.md and docs/GUIDE-WORKING-WITH-CLAUDE.md."

## Phase 2: While Agents Run — Read Previous Changelog

Read `drift-check/CHANGELOG.md` to identify RECURRING vs NEW vs RESOLVED issues.

## Phase 3: Compile Report

Wait for all 5 agents. Write combined report to `drift-check/REPORT.md`:

```
# Drift Check — [date] | Claude Code v[latest] | Template v[ours]

## New in Claude Code
(What changed since our last check)

## What We're Missing
| # | Area | What | Impact | Status |
(Prioritized action items)

## Coverage
| Area | Official | We Use | % |
```

## Phase 3.5: Append to Changelog (MANDATORY)

Append entry to `drift-check/CHANGELOG.md`. Never overwrite.

## Phase 4: Ask User

1. Execute all recommendations
2. Pick specific ones
3. Just save the report
